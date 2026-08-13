import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type InviteRequest = {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: "teacher" | "parent";
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
    const role = body.role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !lastName || !["teacher", "parent"].includes(role ?? "")) {
      return json({ error: "INVALID_INPUT" }, 400);
    }

    const { data: existingProfile, error: existingProfileError } = await userClient
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (existingProfileError) return json({ error: "PROFILE_LOOKUP_FAILED" }, 500);
    if (existingProfile) return json({ error: "ACCOUNT_EXISTS" }, 409);

    const redirectTo = Deno.env.get("ADMIN_INVITE_REDIRECT_URL") || undefined;
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { first_name: firstName, last_name: lastName, role, school_id: adminProfile.school_id },
    });
    if (inviteError || !inviteData.user) {
      return json({ error: inviteError?.message || "INVITE_FAILED" }, inviteError?.status || 400);
    }

    const { error: insertError } = await userClient.rpc("admin_register_invited_profile", {
      invited_user_id: inviteData.user.id,
      invited_email: email,
      invited_first_name: firstName,
      invited_last_name: lastName,
      invited_role: role,
    });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(inviteData.user.id);
      return json({ error: "PROFILE_CREATE_FAILED" }, 500);
    }

    return json({
      user: { id: inviteData.user.id, email, firstName, lastName, role },
      invitationSent: true,
    }, 201);
  } catch (error) {
    console.error("admin-users", error);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
