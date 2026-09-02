import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupportMessage = {
  role?: "user" | "assistant";
  content?: string;
};

type SupportRequest = {
  message?: string;
  history?: SupportMessage[];
  studentContext?: {
    className?: string;
    supportSummary?: string;
    preferredMode?: string;
    communicationMethod?: string;
    learningPreferences?: string[];
    accessibilityInformation?: string;
    additionalNotes?: string;
    pia?: {
      objectives?: Array<{
        title?: string;
        status?: string;
        latestComment?: string;
      }>;
    };
  } | null;
};

type SupportResponse = {
  answer: string;
  actions?: string[];
  observationCue?: string;
  escalation?: string;
  meta?: {
    source: "openrouter" | "fallback";
    model?: string;
    reason?: string;
    safetyMode?: "standard" | "urgent";
  };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = [
  "Ti je asistent pedagogjik per mesimdhenes ne Kosove.",
  "Pergjigju vetem ne shqip me ton te qete dhe praktik.",
  "Mos e perserit pyetjen e mesimdhenesit dhe mos bej permbledhje te gjate.",
  "Jep vetem nje pergjigje natyrale me 1 ose 2 paragrafë te shkurter, rreth 90 deri ne 160 fjale gjithsej.",
  "Shkruaj si keshille e drejtperdrejte per mesimdhenesin: cfare te beje tani, me hapa praktikë brenda paragrafit, jo me pika, jo me tituj, jo me etiketa si Hapat e sugjeruar.",
  "Mos permend PIA, objektiva, diagnoza ose detaje te profilit nese mesimdhenesi nuk pyet drejtperdrejt per to.",
  "Perdor kontekstin vetem per ta bere keshillen me te pershtatshme, jo per ta perseritur.",
  "Ruaj dinjitetin e nxenesit; prefero hapa te vegjel, zgjedhje te qarta dhe mbeshtetje jo-ndeshkuese.",
  "Mos jep keshilla mjekesore ose ligjore, as force, turperim ose izolim te panevojshem.",
  "Nese ka rrezik te menjehershem, thekso sigurine dhe ndjekjen e protokollit te shkolles.",
].join(" ");

const MAX_MESSAGE_LENGTH = 1500;
const FETCH_TIMEOUT_MS = 25000;
const OPENROUTER_MAX_ATTEMPTS = 3;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openrouter/free";
const URGENT_PATTERNS = [
  /vet[eë]\s*l[ëe]nd/i,
  /vras|vrase|vetevras/i,
  /rrezik.*menj[eë]hersh/i,
  /sulm|dhun[ëe]|godet|godas|kafsh/i,
  /arm[eë]|thik[ëe]/i,
  /nuk merr frym[eë]/i,
  /pavet[eë]dij/i,
  /kriz[ëe]|konvulsion|seizure/i,
  /gjakderdh/i,
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function env(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
}

function optionalEnv(name: string) {
  return Deno.env.get(name)?.trim() || "";
}

function supabasePublishableKey() {
  return optionalEnv("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
}

function openRouterApiKey() {
  return env("OPENROUTER_API_KEY");
}

function sanitize(input: string, maxLength = 500) {
  return String(input || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeHistory(history: SupportMessage[] = []) {
  return history
    .slice(-6)
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" as const : "user" as const,
      content: sanitize(item.content || "", 500),
    }))
    .filter((item) => item.content);
}

async function requireTeacher(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new Error("UNAUTHORIZED");

  const userClient = createClient(env("SUPABASE_URL"), supabasePublishableKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user?.id) throw new Error("UNAUTHORIZED");

  const { data: profileData, error: profileError } = await userClient
    .from("profiles")
    .select("id,role,active,is_assistant_teacher")
    .eq("id", authData.user.id)
    .single();
  const profile = profileData as { id: string; role: string; active: boolean; is_assistant_teacher?: boolean } | null;

  if (profileError || !profile || profile.role !== "teacher" || !profile.active || profile.is_assistant_teacher) {
    throw new Error("UNAUTHORIZED");
  }
}

function buildPrompt(input: SupportRequest) {
  const parts = [`Situata: ${sanitize(input.message || "", 500)}`];

  const context = input.studentContext;
  if (context && typeof context === "object") {
    const contextBits = [
      context.className ? `klasa ${sanitize(context.className, 80)}` : "",
      context.supportSummary ? `mbeshtetje: ${sanitize(context.supportSummary, 120)}` : "",
      context.preferredMode ? `menyra e preferuar: ${sanitize(context.preferredMode, 80)}` : "",
      context.communicationMethod ? `komunikimi: ${sanitize(context.communicationMethod, 80)}` : "",
      Array.isArray(context.learningPreferences) && context.learningPreferences.length
        ? `preferencat: ${context.learningPreferences.map((item) => sanitize(item, 32)).filter(Boolean).slice(0, 3).join(", ")}`
        : "",
      context.accessibilityInformation ? `info e dobishme: ${sanitize(context.accessibilityInformation, 100)}` : "",
      context.additionalNotes ? `shenime: ${sanitize(context.additionalNotes, 100)}` : "",
    ].filter(Boolean);

    if (contextBits.length) {
      parts.push(`Kontekst: ${contextBits.join("; ")}.`);
    }
  }

  const history = normalizeHistory(input.history);
  if (history.length) {
    const recentTurns = history.slice(-1)
      .map((item) => `${item.role === "assistant" ? "Asistenti" : "Mesimdhenesi"}: ${sanitize(item.content, 120)}`)
      .join(" || ");
    if (recentTurns) {
      parts.push(`Biseda e fundit: ${recentTurns}.`);
    }
  }

  parts.push("Jep udhezim te thjeshte per cfare te beje mesimdhenesi tani.");

  return parts.join("\n");
}

function classifySafetyMode(input: SupportRequest): "standard" | "urgent" {
  const combined = [
    input.message || "",
    input.studentContext?.supportSummary || "",
    input.studentContext?.additionalNotes || "",
  ].join(" ");
  return URGENT_PATTERNS.some((pattern) => pattern.test(combined)) ? "urgent" : "standard";
}

function fallbackSupport(reason = "", safetyMode: "standard" | "urgent" = "standard"): SupportResponse {
  if (safetyMode === "urgent") {
    return {
      answer: "Kjo duket si situate me rrezik te larte. Flisni me ze te qete, ulni stimujt rreth nxenesit dhe siguroni menjehere nxenesin dhe te tjeret pa debat te gjate.\n\nNjoftoni menjëherë stafin pergjegjes sipas protokollit te shkolles. Nese ka rrezik fizik ose urgjence, ndiqni proceduren emergjente dhe kerkoni ndihme mjekesore.",
      meta: {
        source: "fallback",
        reason: reason || "URGENT_SAFETY_MODE",
        safetyMode,
      },
    };
  }
  return {
    answer: "Filloni me nje ton te qete dhe jepni nje udhezim te vetem, te shkurter, qe nxenesi mund ta ndjeke menjehere. Ulni pak zhurmen ose ngarkesen rreth tij dhe ofroni nje hap te vogel ose nje zgjedhje te thjeshte qe ta ndihmoje te rikthehet ne aktivitet.\n\nVezhgoni nese qetesohet pas kesaj nderhyrjeje te shkurter. Nese situata perkeqesohet ose shfaqet rrezik, ndiqni protokollin e shkolles dhe kerkoni ndihme shtese.",
    meta: {
      source: "fallback",
      reason: reason || "AI_UNAVAILABLE",
      safetyMode,
    },
  };
}

function normalizeSupportResponse(payload: unknown, model: string, fallbackReason = "", safetyMode: "standard" | "urgent" = "standard"): SupportResponse {
  const parsed = payload as { answer?: string } | null;
  const answer = typeof parsed?.answer === "string" ? parsed.answer.trim() : "";
  if (!answer) return fallbackSupport(fallbackReason || "MISSING_FIELDS", safetyMode);

  return {
    answer,
    meta: {
      source: "openrouter",
      model,
      safetyMode,
    },
  };
}

function extractCompletionText(payload: unknown) {
  const parsed = payload as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  } | null;

  if (!parsed || typeof parsed !== "object") return "";
  const text = parsed.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : "";
}

function normalizeAssistantAnswer(text: string) {
  return text
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/\*\*Hapat e sugjeruar\*\*[\s\S]*$/i, "")
    .replace(/\*\*Çfarë të vëzhgoni\*\*[\s\S]*$/i, "")
    .replace(/\*\*Kur të eskaloni\*\*[\s\S]*$/i, "")
    .replace(/Hapat e sugjeruar[\s\S]*$/i, "")
    .replace(/Çfarë të vëzhgoni[\s\S]*$/i, "")
    .replace(/Kur të eskaloni[\s\S]*$/i, "")
    .trim();
}

function isUsableAssistantAnswer(answer: string, model: string) {
  const normalized = answer.trim();
  const blockedModel = /safety|guard|moderation|code/i.test(model);
  const blockedAnswer = /^user safety:/i.test(normalized) || /^safe$/i.test(normalized);
  const endsCleanly = /[.!?…"]$/.test(normalized);
  return !blockedModel && !blockedAnswer && normalized.length >= 80 && endsCleanly;
}

async function generateSupport(input: SupportRequest): Promise<SupportResponse> {
  const safetyMode = classifySafetyMode(input);
  if (safetyMode === "urgent") {
    return fallbackSupport("URGENT_SAFETY_MODE", safetyMode);
  }

  const apiKey = openRouterApiKey();
  const prompt = buildPrompt(input);
  let lastReason = "AI_UNAVAILABLE";

  for (let attempt = 1; attempt <= OPENROUTER_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        response = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 320,
            reasoning: {
              effort: "none",
              exclude: true,
            },
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastReason = error instanceof DOMException && error.name === "AbortError"
        ? "OPENROUTER_TIMEOUT"
        : "OPENROUTER_NETWORK_ERROR";
      console.error("OPENROUTER_FETCH_ERROR", attempt, error);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      lastReason = `OPENROUTER_${response.status}`;
      console.error("OPENROUTER_ERROR", attempt, response.status, errorText);
      if (response.status === 429 || response.status >= 500) continue;
      return fallbackSupport(lastReason, safetyMode);
    }

    const payload = await response.json() as { model?: string };
    const text = extractCompletionText(payload);

    if (!text) {
      lastReason = "EMPTY_TEXT";
      continue;
    }

    try {
      const cleanedAnswer = normalizeAssistantAnswer(text);
      const responseModel = payload.model || OPENROUTER_MODEL;
      if (!cleanedAnswer) {
        lastReason = "EMPTY_TEXT";
        continue;
      }
      if (!isUsableAssistantAnswer(cleanedAnswer, responseModel)) {
        lastReason = "LOW_QUALITY_RESPONSE";
        continue;
      }
      return normalizeSupportResponse({ answer: cleanedAnswer }, responseModel, "", safetyMode);
    } catch (error) {
      lastReason = "PARSE_ERROR";
      console.error("OPENROUTER_PARSE_ERROR", attempt, error, text);
      continue;
    }
  }

  return fallbackSupport(lastReason, safetyMode);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    await requireTeacher(request);
    const body = await request.json().catch(() => ({})) as SupportRequest;
    const message = sanitize(body.message || "", MAX_MESSAGE_LENGTH);

    if (!message) {
      return json(fallbackSupport("EMPTY_MESSAGE"));
    }

    return json(await generateSupport({
      message,
      history: normalizeHistory(body.history),
      studentContext: body.studentContext || null,
    }));
  } catch (error) {
    console.error("support function failed", error);
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return json({ error: "UNAUTHORIZED" }, 401);
    }
    return json(fallbackSupport(error instanceof Error ? error.message : "UNKNOWN_ERROR"));
  }
});
