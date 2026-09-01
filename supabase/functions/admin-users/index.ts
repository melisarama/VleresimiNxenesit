import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type InviteRequest = {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: "teacher" | "assistant_teacher" | "parent";
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
    const role = body.role === "teacher" || body.role === "assistant_teacher" || body.role === "parent" ? body.role : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !firstName || !lastName || !role) {
      return json({ error: "INVALID_INPUT" }, 400);
    }
    const invitedRole = role === "assistant_teacher" ? "teacher" : role;
    const isAssistantTeacher = role === "assistant_teacher";

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
      user_metadata: {
        first_name: firstName,
        last_name: lastName,
        role: invitedRole,
        school_id: adminProfile.school_id,
        is_assistant_teacher: isAssistantTeacher,
      },
    });
    if (createError || !createData.user) {
      return json({ error: createError?.message || "ACCOUNT_CREATE_FAILED" }, createError?.status || 400);
    }

    const { error: insertError } = await userClient.rpc("admin_register_invited_profile", {
      invited_user_id: createData.user.id,
      invited_email: email,
      invited_first_name: firstName,
      invited_last_name: lastName,
      invited_role: invitedRole,
      invited_is_assistant_teacher: isAssistantTeacher,
    });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(createData.user.id);
      return json({ error: "PROFILE_CREATE_FAILED" }, 500);
    }

    return json({
      user: { id: createData.user.id, email, firstName, lastName, role },
      temporaryPassword,
      invitationSent: false,
      accountEmailSent: false,
    }, 201);
  } catch (error) {
    console.error("admin-users", error);
    return json({ error: "SERVER_ERROR" }, 500);
  }
});
