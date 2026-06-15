import { SmtpClient } from "https://deno.land/x/denomailer/mod.ts";

const SMTP_HOST = Deno.env.get("SMTP_HOST");
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") || 587);
const SMTP_USER = Deno.env.get("SMTP_USER");
const SMTP_PASS = Deno.env.get("SMTP_PASS");
const SENDER_EMAIL = Deno.env.get("SMTP_ADMIN_EMAIL") || "noreply@m0x.in";
const SENDER_NAME = Deno.env.get("SMTP_SENDER_NAME") || "M0X Labs";

async function sendSmtpEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error("SMTP credentials are not configured in the environment.");
    throw new Error("SMTP credentials not configured");
  }

  const client = new SmtpClient();
  try {
    await client.connect({
      hostname: SMTP_HOST,
      port: SMTP_PORT,
      username: SMTP_USER,
      password: SMTP_PASS,
    });

    await client.send({
      from: `${SENDER_NAME} <${SENDER_EMAIL}>`,
      to,
      subject,
      html,
    });
    console.log(`Successfully sent email "${subject}" to ${to} via SMTP`);
  } catch (error) {
    console.error(`Failed to send email "${subject}" to ${to} via SMTP:`, error);
    throw error;
  } finally {
    try {
      await client.close();
    } catch {}
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  try {
    const payload = await req.json();
    console.log("Received webhook payload:", payload);

    // Payload can come from database trigger webhook: { record: { email, raw_user_meta_data } }
    const record = payload.record || payload;
    const email = record.email;
    const meta = record.raw_user_meta_data || {};
    const fullName = meta.full_name || meta.name || payload.fullName || email?.split("@")[0] || "User";

    if (!email) {
      return new Response(JSON.stringify({ error: "Email is required in request record" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    console.log(`Processing signup email flow for ${email} (${fullName})`);

    // A. Welcome Email (Immediate)
    let welcomeHtml = "";
    try {
      const welcomeRes = await fetch("http://templates-server/welcome.html");
      if (welcomeRes.ok) {
        welcomeHtml = await welcomeRes.text();
      } else {
        throw new Error(`Failed to fetch welcome.html: ${welcomeRes.statusText}`);
      }
    } catch (err) {
      console.error("Error fetching welcome.html:", err);
    }

    if (welcomeHtml) {
      console.log(`Sending immediate welcome email to ${email} via SMTP...`);
      try {
        await sendSmtpEmail({
          to: email,
          subject: "Welcome to m0xide",
          html: welcomeHtml,
        });
      } catch (err) {
        console.error("Failed to send welcome email via SMTP:", err);
      }
    }

    // B. Subscription Plan Notification Email (Scheduled 3 minutes later in background)
    let planHtml = "";
    try {
      const planRes = await fetch("http://templates-server/sugnup-plan-notification.html");
      if (planRes.ok) {
        planHtml = await planRes.text();
      } else {
        throw new Error(`Failed to fetch sugnup-plan-notification.html: ${planRes.statusText}`);
      }
    } catch (err) {
      console.error("Error fetching sugnup-plan-notification.html:", err);
    }

    if (planHtml) {
      // Schedule the email to run 3 minutes in the background
      setTimeout(async () => {
        const personalizedHtml = planHtml
          .replaceAll("Hi developer, your Free plan with m0xide is now active!", `Hi ${fullName}, your Free plan with m0xide is now active!`)
          .replaceAll("Hi Name Surname, your subscription has been renewed.", `Hi ${fullName}, your Free plan is active!`);

        console.log(`Sending delayed subscription plan email to ${email} via SMTP...`);
        try {
          await sendSmtpEmail({
            to: email,
            subject: "Your Free Plan with m0xide",
            html: personalizedHtml,
          });
        } catch (err) {
          console.error("Failed to send delayed subscription plan email:", err);
        }
      }, 3 * 60 * 1000);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Error in edge function signup-email-trigger:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
