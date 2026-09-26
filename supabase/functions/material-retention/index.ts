import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "RETENTION_FAILED";
}

async function deleteStoredMaterialPaths(admin: ReturnType<typeof createClient>, paths: string[]) {
  const storageApiBaseUrl = Deno.env.get("STORAGE_API_BASE_URL")?.replace(/\/+$/, "");
  const storageServiceSecret = Deno.env.get("STORAGE_SERVICE_SECRET");

  if (storageApiBaseUrl && storageServiceSecret) {
    const body = new URLSearchParams();
    for (const path of paths) body.append("paths[]", path);

    const response = await fetch(`${storageApiBaseUrl}/delete.php`, {
      method: "POST",
      headers: {
        "x-storage-service-secret": storageServiceSecret,
      },
      body,
    });

    if (!response.ok) {
      let reason = "REMOTE_STORAGE_DELETE_FAILED";
      try {
        const payload = await response.json();
        if (payload?.error) reason = payload.error;
      } catch {
        reason = await response.text().catch(() => reason);
      }
      throw new Error(reason);
    }
    return;
  }

  const { error: storageError } = await admin.storage.from("class-materials").remove(paths);
  if (storageError) throw storageError;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const expectedSecret = env("MATERIAL_RETENTION_CRON_SECRET");
    if (request.headers.get("x-cron-secret") !== expectedSecret) return json({ error: "UNAUTHORIZED" }, 401);

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const now = new Date();
    const warningCutoff = new Date(now.getTime() + 7 * 86400000).toISOString();

    const { data: expiring, error: expiringError } = await admin
      .from("class_materials")
      .select("id,teacher_id,expires_at")
      .not("expires_at", "is", null)
      .is("warning_sent_at", null)
      .gt("expires_at", now.toISOString())
      .lte("expires_at", warningCutoff)
      .limit(500);
    if (expiringError) throw expiringError;

    let warned = 0;
    for (const material of expiring ?? []) {
      const { error: warningError } = await admin.from("material_retention_warnings").upsert({
        material_id: material.id,
        teacher_id: material.teacher_id,
        expires_at: material.expires_at,
      }, { onConflict: "material_id", ignoreDuplicates: true });
      if (warningError) throw warningError;
      const { error: updateError } = await admin
        .from("class_materials")
        .update({ warning_sent_at: now.toISOString() })
        .eq("id", material.id);
      if (updateError) throw updateError;
      warned += 1;
    }

    const { data: expired, error: expiredError } = await admin
      .from("class_materials")
      .select("id,class_material_files(storage_path)")
      .not("expires_at", "is", null)
      .lte("expires_at", now.toISOString())
      .limit(200);
    if (expiredError) throw expiredError;

    let deleted = 0;
    const failures: Array<{ id: string; error: string }> = [];
    for (const material of expired ?? []) {
      try {
        const paths = (material.class_material_files ?? []).map((file: { storage_path: string }) => file.storage_path);
        if (paths.length) {
          await deleteStoredMaterialPaths(admin, paths);
        }
        const { error: deleteError } = await admin.from("class_materials").delete().eq("id", material.id);
        if (deleteError) throw deleteError;
        deleted += 1;
      } catch (error) {
        failures.push({ id: material.id, error: errorMessage(error) });
      }
    }

    return json({ warned, deleted, failures });
  } catch (error) {
    console.error("material-retention", error);
    return json({ error: errorMessage(error) }, 500);
  }
});
