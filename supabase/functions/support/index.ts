type SupportMessage = {
  role?: "user" | "assistant";
  content?: string;
};

type SupportStudent = {
  id?: string;
  name?: string;
  className?: string;
  supportSummary?: string;
  preferredMode?: string;
  learningPreferences?: string[];
  communicationLanguage?: string;
  communicationMethod?: string;
  accessibilityInformation?: string;
};

type SupportRequest = {
  message?: string;
  history?: SupportMessage[];
  student?: SupportStudent | null;
};

type SupportResponse = {
  answer: string;
  actions: string[];
  observationCue: string;
  escalation: string;
};

interface AIProvider {
  generateSupport(input: SupportRequest): Promise<SupportResponse>;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPPORT_SYSTEM_PROMPT = [
  "Ti je asistent pedagogjik për mësimdhënës në Kosovë.",
  "Përgjigju vetëm në shqip, me ton të qetë, empatik dhe praktik.",
  "Ndihmo me strategji de-escalimi, vetërregullim, komunikim të qartë, mbështetje sensoriale, vëzhgim të sjelljes dhe kur të kërkohet ndihmë shtesë.",
  "Mos jep diagnozë, terapi ose këshilla mjekësore.",
  "Mos sugjero ndëshkim, kufizim fizik ose ndërhyrje të pasigurt.",
  "Mos shpik detaje për nxënësin apo rregulla të shkollës që nuk janë dhënë.",
  "Nëse ka rrezik të menjëhershëm për nxënësin, klasën ose stafin, thuaj menjëherë të ndiqen protokollet e shkollës dhe shërbimet emergjente lokale.",
  "Kur mungojnë detaje, jep një hap të sigurt të parë dhe një pyetje sqaruese të shkurtër."
].join(" ");

const SUPPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "actions", "observationCue", "escalation"],
  properties: {
    answer: { type: "string" },
    actions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string" },
    },
    observationCue: { type: "string" },
    escalation: { type: "string" },
  },
} as const;

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

function optionalEnv(name: string): string {
  return Deno.env.get(name)?.trim() || "";
}

function sanitize(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[numër]")
    .replace(/\b[A-ZÇË][a-zçë]+ [A-ZÇË][a-zçë]+\b/g, "[emër]")
    .trim();
}

function containsImmediateRisk(input: string): boolean {
  return /vets[eë]vras|suicid|vet[eë]l[eë]nd|dhun|arm[eë]|abuz|rrezik i menj[eë]hersh[eë]m|plagos|godit/i.test(input);
}

function normalizeHistory(history: SupportMessage[] = []): Array<{ role: "user" | "assistant"; content: string }> {
  return history
    .slice(-8)
    .map(item => ({
      role: (item.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: sanitize(String(item.content || "")).slice(0, 1000),
    }))
    .filter(item => item.content);
}

function studentContext(student: SupportStudent | null | undefined) {
  if (!student) return "";
  const rows = [
    student.name ? `Nxënësi: ${student.name}` : "",
    student.className ? `Klasa: ${student.className}` : "",
    student.supportSummary ? `Përmbledhje mbështetëse: ${student.supportSummary}` : "",
    student.preferredMode ? `Mënyra e preferuar: ${student.preferredMode}` : "",
    student.learningPreferences?.length ? `Preferencat: ${student.learningPreferences.join(", ")}` : "",
    student.communicationLanguage ? `Gjuha e komunikimit: ${student.communicationLanguage}` : "",
    student.communicationMethod ? `Mënyra e komunikimit: ${student.communicationMethod}` : "",
    student.accessibilityInformation ? `Qasshmëria: ${student.accessibilityInformation}` : "",
  ].filter(Boolean);
  return rows.length ? rows.join("\n") : "";
}

function buildInputSections(input: SupportRequest) {
  const sections: Array<{ role: "user" | "assistant"; content: Array<{ type: "input_text"; text: string }> }> = [];
  const context = studentContext(input.student);
  if (context) {
    sections.push({
      role: "user",
      content: [{ type: "input_text", text: `Konteksti i nxënësit:\n${context}` }],
    });
  }
  normalizeHistory(input.history).forEach(message => {
    const role: "user" | "assistant" = message.role === "assistant" ? "assistant" : "user";
    sections.push({
      role,
      content: [{ type: "input_text", text: message.content }],
    });
  });
  const finalMessage = sanitize(String(input.message || "")).trim();
  if (finalMessage) {
    sections.push({
      role: "user",
      content: [{ type: "input_text", text: finalMessage }],
    });
  }
  return sections;
}

function parseResponse(payload: unknown): SupportResponse {
  const outputText =
    (payload as { output_text?: string }).output_text ??
    (payload as {
      output?: Array<{ content?: Array<{ text?: string }> }>;
    }).output?.flatMap(item => item.content ?? []).map(content => content.text).filter(Boolean).join("\n") ??
    "";
  if (!outputText) throw new Error("OPENAI_EMPTY_RESPONSE");
  const parsed = JSON.parse(outputText) as SupportResponse;
  if (!parsed || typeof parsed.answer !== "string" || !Array.isArray(parsed.actions) || typeof parsed.observationCue !== "string" || typeof parsed.escalation !== "string") {
    throw new Error("OPENAI_INVALID_RESPONSE");
  }
  return parsed;
}

class OpenAIProvider implements AIProvider {
  async generateSupport(input: SupportRequest): Promise<SupportResponse> {
    const apiKey = env("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-5";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_output_tokens: 350,
        instructions: SUPPORT_SYSTEM_PROMPT,
        input: buildInputSections(input),
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "teacher_support_assistant",
            strict: true,
            schema: SUPPORT_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("GEMINI_ERROR:", response.status, errorText);
      if (response.status === 400) throw new Error(`GEMINI_400: Bad request — model name may be wrong. Model used: ${model}`);
      if (response.status === 403) throw new Error("GEMINI_403: API key does not have access. Ensure Gemini API is enabled.");
      if (response.status === 404) throw new Error(`GEMINI_404: Model not found (${model}). Try GEMINI_MODEL=gemini-2.0-flash in Supabase Secrets.`);
      if (response.status === 429) throw new Error("GEMINI_429: Rate limit reached. Wait a moment and try again.");
      throw new Error(`GEMINI_${response.status}: ${errorText.slice(0, 200)}`);
    }

    return parseResponse(await response.json());
  }
}

function provider(): AIProvider {
  const providerName = (Deno.env.get("AI_PROVIDER") || "openai").toLowerCase();
  if (providerName === "openai") return new OpenAIProvider();
  throw new Error("AI_PROVIDER_UNSUPPORTED");
}

async function requireTeacher(request: Request): Promise<void> {
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new Error("UNAUTHORIZED");

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: serviceKey },
  });
  if (!userResponse.ok) throw new Error("UNAUTHORIZED");
  const user = await userResponse.json();

  const profileResponse = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&role=eq.teacher&active=eq.true&select=id`,
    { headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey } },
  );
  if (!profileResponse.ok) throw new Error("UNAUTHORIZED");
  const profiles = await profileResponse.json();
  if (!profiles.length) throw new Error("UNAUTHORIZED");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    await requireTeacher(request);
    const body = (await request.json().catch(() => ({}))) as SupportRequest;
    const message = sanitize(String(body.message || "")).trim();
    const history = normalizeHistory(body.history);
    if (!message || message.length > 2000) {
      return json({ error: "Shkruani një situatë me më pak se 2000 shkronja." }, 400);
    }

    const riskCheck = [message, ...history.map(item => item.content)].join("\n");
    if (containsImmediateRisk(riskCheck)) {
      return json({
        answer: "Kjo duket si situatë sigurie dhe nuk duhet të trajtohet vetëm nga asistenti.",
        actions: [
          "Siguroni praninë e një të rrituri përgjegjës pranë nxënësit.",
          "Ndiqni menjëherë protokollin e mbrojtjes së shkollës.",
          "Kontaktoni shërbimet emergjente lokale nëse rreziku është i afërt.",
        ],
        observationCue: "Shënoni vetëm faktet e vëzhguara dhe kujt iu raportua situata.",
        escalation: "Ndiqni protokollin e shkollës për mbrojtje dhe urgjencë.",
      } satisfies SupportResponse);
    }

    return json(await provider().generateSupport({
      message,
      history,
      student: body.student || null,
    }));
  } catch (error) {
    console.error("support function failed", error);
    const message = error instanceof Error && error.message === "UNAUTHORIZED"
      ? "Nuk keni qasje në këtë asistent."
      : error instanceof Error && error.message === "OPENAI_API_KEY_MISSING"
        ? "Asistenti nuk është i konfiguruar ende."
        : "Asistenti nuk mundi të përgjigjet tani. Provoni përsëri.";
    return json({ error: message }, error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 503);
  }
});
