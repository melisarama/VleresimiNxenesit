import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupportMessage = {
  role?: "user" | "assistant";
  content?: string;
};

type SupportRequest = {
  message?: string;
  history?: SupportMessage[];
};

type SupportResponse = {
  answer: string;
  actions: string[];
  observationCue: string;
  escalation: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = [
  "Ti je asistent pedagogjik per mesimdhenes ne Kosove.",
  "Pergjigju vetem ne shqip.",
  "Jep nje pergjigje te shkurter, tre hapa praktike, nje gje per vezhgim dhe nje keshille per eskalim.",
  "Mos jep diagnoza ose keshilla mjekesore.",
  "Kthe vetem nje objekt JSON me fushat: answer, actions, observationCue, escalation.",
].join(" ");

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

function candidateModels() {
  const configured = optionalEnv("GEMINI_MODEL");
  const defaults = ["gemini-2.5-flash", "gemini-3.6-flash"];
  return [configured, ...defaults].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index);
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
    .select("id,role,active")
    .eq("id", authData.user.id)
    .single();
  const profile = profileData as { id: string; role: string; active: boolean } | null;

  if (profileError || !profile || profile.role !== "teacher" || !profile.active) {
    throw new Error("UNAUTHORIZED");
  }
}

function buildPrompt(input: SupportRequest) {
  const parts = [
    "Situata e mesimdhenesit:",
    sanitize(input.message || "", 1500),
  ];

  const history = normalizeHistory(input.history);
  if (history.length) {
    parts.push("Biseda e fundit:");
    history.forEach((item) => {
      parts.push(`${item.role === "assistant" ? "Asistenti" : "Mesimdhenesi"}: ${item.content}`);
    });
  }

  parts.push("Formati i sakte:");
  parts.push('{"answer":"...", "actions":["...", "...", "..."], "observationCue":"...", "escalation":"..."}');
  return parts.join("\n");
}

function fallbackSupport(message = ""): SupportResponse {
  const shortMessage = sanitize(message, 200);
  return {
    answer: shortMessage
      ? `Per kete situate, filloni me qetesi dhe nje udhezim te thjeshte: ${shortMessage}`
      : "Filloni me qetesi, nje udhezim te thjeshte dhe nje hap te vogel qe nxenesi mund ta ndjeke menjehere.",
    actions: [
      "Flisni me ze te qete dhe jepni nje udhezim te vetem te shkurter.",
      "Ofroni nje zgjedhje te thjeshte ose nje hap te vogel qe nxenesi mund ta beje tani.",
      "Ulni stimulimin rreth nxenesit dhe jepini pak kohe per t'u rregulluar.",
    ],
    observationCue: "Vezhgoni nese qetesohet pas udhezimit te shkurter dhe nese e pranon zgjedhjen e ofruar.",
    escalation: "Nese sjellja perkeqesohet ose ka rrezik, ndiqni protokollin e shkolles dhe kerkoni ndihme shtese.",
  };
}

function normalizeSupportResponse(payload: unknown, message = ""): SupportResponse {
  const parsed = payload as Partial<SupportResponse> | null;
  if (!parsed || typeof parsed !== "object") return fallbackSupport(message);

  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, 3)
    : [];
  const observationCue = typeof parsed.observationCue === "string" ? parsed.observationCue.trim() : "";
  const escalation = typeof parsed.escalation === "string" ? parsed.escalation.trim() : "";

  if (!answer || !observationCue || !escalation) return fallbackSupport(message);

  while (actions.length < 3) {
    actions.push(fallbackSupport(message).actions[actions.length]);
  }

  return {
    answer,
    actions,
    observationCue,
    escalation,
  };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return trimmed;
  return trimmed.slice(start, end + 1);
}

async function generateSupport(input: SupportRequest): Promise<SupportResponse> {
  const apiKey = env("GEMINI_API_KEY");

  for (const model of candidateModels()) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [{
          role: "user",
          parts: [{ text: buildPrompt(input) }],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("GEMINI_ERROR", model, response.status, errorText);
      if (response.status === 404) continue;
      throw new Error(`GEMINI_${response.status}`);
    }

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (payload.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => typeof part.text === "string" ? part.text : "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) return fallbackSupport(input.message || "");

    try {
      return normalizeSupportResponse(JSON.parse(extractJsonObject(text)), input.message || "");
    } catch (error) {
      console.error("GEMINI_PARSE_ERROR", error);
      return fallbackSupport(input.message || "");
    }
  }

  return fallbackSupport(input.message || "");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    await requireTeacher(request);
    const body = await request.json().catch(() => ({})) as SupportRequest;
    const message = sanitize(body.message || "", 1500);

    if (!message) {
      return json(fallbackSupport(""));
    }

    return json(await generateSupport({
      message,
      history: normalizeHistory(body.history),
    }));
  } catch (error) {
    console.error("support function failed", error);
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return json({ error: "UNAUTHORIZED" }, 401);
    }
    return json(fallbackSupport(""));
  }
});
