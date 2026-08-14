import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type InviteRequest = {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: "teacher" | "parent";
};

type EmailDelivery = {
  id: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 80) : "";
}

function optionalEnv(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

function randomPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%";
  const all = upper + lower + digits + symbols;
  const picks = [upper, lower, digits, symbols, all, all, all, all, all, all, all, all, all, all];
  const bytes = new Uint8Array(picks.length);
  crypto.getRandomValues(bytes);
  return picks.map((characters, index) => characters[bytes[index] % characters.length]).join("");
}

function roleLabel(role: "teacher" | "parent") {
  return role === "teacher" ? "mësimdhënës" : "prind";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function accountEmail({ firstName, email, password, role }: { firstName: string; email: string; password: string; role: "teacher" | "parent" }) {
  const appUrl = optionalEnv("EMAIL_APP_URL") || optionalEnv("ADMIN_INVITE_REDIRECT_URL") || "";
  const roleText = roleLabel(role);
  const text = [
    `Përshëndetje ${firstName},`,
    "",
    "Më poshtë mund t'i gjeni informatat për llogarinë tuaj në aplikacionin Vlerësimi.",
    "",
    `Roli: ${roleText}`,
    `Email: ${email}`,
    `Password: ${password}`,
    appUrl ? `Platforma: ${appUrl}` : "",
    "",
    "Ju lutemi ndryshoni fjalëkalimin pas hyrjes së parë.",
  ].filter(Boolean).join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#29233f">
      <h1 style="font-size:20px;margin:0 0 14px">Përshëndetje ${escapeHtml(firstName)},</h1>
      <p>Më poshtë mund t'i gjeni informatat për llogarinë tuaj në aplikacionin Vlerësimi.</p>
      <div style="padding:14px;border:1px solid #ded9ec;border-radius:10px;background:#faf9ff">
        <p style="margin:0 0 6px"><strong>Roli:</strong> ${escapeHtml(roleText)}</p>
        <p style="margin:0 0 6px"><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p style="margin:0"><strong>Password:</strong> ${escapeHtml(password)}</p>
      </div>
      ${appUrl ? `<p style="margin:18px 0 0"><a href="${escapeHtml(appUrl)}" style="color:#7056c4">Hap platformën</a></p>` : ""}
      <p style="margin:18px 0 0;color:#676075">Ju lutemi ndryshoni fjalëkalimin pas hyrjes së parë.</p>
    </div>
  `;
  return { text, html };
}

async function dispatchDelivery(supabaseUrl: string, deliveryId: string) {
  const response = await fetch(`${supabaseUrl}/functions/v1/email-dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-email-secret": env("EMAIL_DISPATCH_SECRET") },
    body: JSON.stringify({ deliveryId }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "EMAIL_DISPATCH_FAILED" }));
    throw new Error(typeof payload.error === "string" ? payload.error : "EMAIL_DISPATCH_FAILED");
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "UNAUTHORIZED" }, 401);

  try {
    const supabaseUrl = env("SUPABASE_URL");
    const publishableKey = env("SUPABASE_ANON_KEY");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "UNAUTHORIZED" }, 401);

    const { data: adminProfile, error: profileError } = await userClient
      .from("profiles")
      .select("id,school_id,role,active")
      .eq("id", authData.user.id)
      .single();
    if (profileError || !adminProfile || adminProfile.role !== "admin" || !adminProfile.active || !adminProfile.school_id) {
      return json({ error: "FORBIDDEN" }, 403);
    }

    const body = (await request.json()) as InviteRequest;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const firstName = cleanName(body.firstName);
    const lastName = cleanName(body.lastName);
    const role = body.role === "teacher" || body.role === "parent" ? body.role : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !lastName || !role) {
      return json({ error: "INVALID_INPUT" }, 400);
    }

    const { data: existingProfile, error: existingProfileError } = await userClient
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existingProfileError) return json({ error: "PROFILE_LOOKUP_FAILED" }, 500);
    if (existingProfile) return json({ error: "ACCOUNT_EXISTS" }, 409);

    const temporaryPassword = randomPassword();
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, role, school_id: adminProfile.school_id },
    });
    if (createError || !createData.user) {
      return json({ error: createError?.message || "ACCOUNT_CREATE_FAILED" }, createError?.status || 400);
    }

    const { error: insertError } = await userClient.rpc("admin_register_invited_profile", {
      invited_user_id: createData.user.id,
      invited_email: email,
      invited_first_name: firstName,
      invited_last_name: lastName,
      invited_role: role,
    });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(createData.user.id);
      return json({ error: "PROFILE_CREATE_FAILED" }, 500);
    }

    const emailContent = accountEmail({ firstName, email, password: temporaryPassword, role });
    const { data: delivery, error: deliveryError } = await adminClient
      .from("email_deliveries")
      .insert({
        recipient_id: createData.user.id,
        recipient_email: email,
        template: "account_invite",
        subject: "Llogaria juaj në aplikacionin Vlerësimi",
        body_text: emailContent.text,
        body_html: emailContent.html,
        source_created_at: new Date().toISOString(),
      })
      .select("id")
      .single<EmailDelivery>();
    if (deliveryError || !delivery) {
      await adminClient.auth.admin.deleteUser(createData.user.id);
      return json({ error: "ACCOUNT_EMAIL_QUEUE_FAILED" }, 500);
    }

    try {
      await dispatchDelivery(supabaseUrl, delivery.id);
    } catch (error) {
      await adminClient.auth.admin.deleteUser(createData.user.id);
      console.error("account email dispatch", error);
      return json({ error: "ACCOUNT_EMAIL_SEND_FAILED" }, 502);
    }

    return json({
      user: { id: createData.user.id, email, firstName, lastName, role },
      invitationSent: true,
      accountEmailSent: true,
    }, 201);
  } catch (error) {
    console.error("admin-users", error);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
