import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type EmailDelivery = {
  id: string;
  recipient_email: string;
  subject: string;
  body_text: string;
  body_html: string;
  attempts: number;
};

type ResendResponse = {
  id?: string;
  message?: string;
  name?: string;
};

type DispatchRequest = {
  deliveryId?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function optionalEnv(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

function resendApiKey(): string {
  return optionalEnv("RESEND_API_KEY") || env("RESEND_EMAIL_API_KEY");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "EMAIL_DISPATCH_FAILED";
}

function appendAppLink(html: string, text: string, appUrl: string) {
  if (!appUrl) return { html, text };
  const normalized = appUrl.replace(/\/+$/, "");
  return {
    text: `${text}\n\nPlatforma: ${normalized}`,
    html: `${html}<p style="margin:18px 0 0"><a href="${normalized}" style="color:#7056c4">Hap platformën</a></p>`,
  };
}

async function sendWithResend(delivery: EmailDelivery) {
  const appUrl = optionalEnv("EMAIL_APP_URL");
  const testRecipient = optionalEnv("EMAIL_TEST_RECIPIENT");
  const replyTo = optionalEnv("EMAIL_REPLY_TO");
  const content = appendAppLink(delivery.body_html, delivery.body_text, appUrl);
  const to = testRecipient || delivery.recipient_email;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: optionalEnv("EMAIL_FROM") || "Mesim i Qarte <onboarding@resend.dev>",
      to,
      subject: delivery.subject,
      text: content.text,
      html: content.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({} as ResendResponse));
  if (!response.ok) {
    throw new Error(payload.message || payload.name || `RESEND_${response.status}`);
  }
  return payload.id || "";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.headers.get("x-email-secret") !== env("EMAIL_DISPATCH_SECRET")) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const body = await request.json().catch(() => ({} as DispatchRequest)) as DispatchRequest;

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const limit = Math.min(Math.max(Number(optionalEnv("EMAIL_DISPATCH_LIMIT")) || 25, 1), 100);
  const maxAttempts = Math.min(Math.max(Number(optionalEnv("EMAIL_MAX_ATTEMPTS")) || 3, 1), 10);

  let query = admin
    .from("email_deliveries")
    .select("id,recipient_email,subject,body_text,body_html,attempts")
    .in("status", ["queued", "failed"])
    .lt("attempts", maxAttempts)
    .order("created_at", { ascending: true });
  query = body.deliveryId ? query.eq("id", body.deliveryId).limit(1) : query.limit(limit);
  const { data: deliveries, error: loadError } = await query;
  if (loadError) return json({ error: loadError.message }, 500);
  if (dryRun) {
    return json({
      dryRun: true,
      loaded: deliveries?.length || 0,
      ids: (deliveries || []).map((delivery) => delivery.id),
    });
  }

  let sent = 0;
  let failed = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const delivery of (deliveries || []) as EmailDelivery[]) {
    const now = new Date().toISOString();
    const nextAttempts = (delivery.attempts || 0) + 1;
    await admin
      .from("email_deliveries")
      .update({ status: "sending", attempts: nextAttempts, last_attempt_at: now, updated_at: now })
      .eq("id", delivery.id);

    try {
      const messageId = await sendWithResend(delivery);
      const sentAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("email_deliveries")
        .update({
          status: "sent",
          provider_message_id: messageId,
          error: null,
          sent_at: sentAt,
          updated_at: sentAt,
        })
        .eq("id", delivery.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (error) {
      const message = errorMessage(error).slice(0, 1000);
      const failedAt = new Date().toISOString();
      await admin
        .from("email_deliveries")
        .update({ status: "failed", error: message, updated_at: failedAt })
        .eq("id", delivery.id);
      failed += 1;
      failures.push({ id: delivery.id, error: message });
    }
  }

  return json({ loaded: deliveries?.length || 0, sent, failed, failures });
});
