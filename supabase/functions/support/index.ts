type SupportRequest = {
  situation?: string;
};

type SupportResponse = {
  observation: string;
  actions: string[];
  observationCue: string;
  escalation?: string;
};

interface AIProvider {
  generateSupport(input: string): Promise<SupportResponse>;
}

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

function containsImmediateRisk(input: string): boolean {
  return /vet[eë]l[eë]nd|vetvras|suicid|dhun|rrezik i menj[eë]hersh[eë]m|arm[eë]|abuz/i.test(input);
}

function sanitize(input: string): string {
  return input
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[numër]")
    .replace(/\b[A-ZÇË][a-zçë]+ [A-ZÇË][a-zçë]+\b/g, "[emër]")
    .trim();
}

class GeminiProvider implements AIProvider {
  async generateSupport(input: string): Promise<SupportResponse> {
    const apiKey = env("GEMINI_API_KEY");
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash";

    // Google AI Studio (2026+) issues "AQ." authorization keys sent via x-goog-api-key header.
    // Legacy "AIzaSy" keys are sent via the ?key= query parameter.
    // Both formats are supported here.
    const isAuthKey = apiKey.startsWith("AQ.");
    const url = isAuthKey
      ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isAuthKey) headers["x-goog-api-key"] = apiKey;

    const systemInstruction =
      "Ti je asistent pedagogjik për mësimdhënës në Kosovë. Përgjigju vetëm në shqip. Mos diagnostiko, mos kërko të dhëna identifikuese dhe mos zëvendëso protokollet e shkollës. Jep hapa praktikë, të shkurtër dhe mbështetës për klasë.";

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          { parts: [{ text: input }] },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              observation: { type: "STRING" },
              actions: {
                type: "ARRAY",
                items: { type: "STRING" },
              },
              observationCue: { type: "STRING" },
              escalation: { type: "STRING" },
            },
            required: ["observation", "actions", "observationCue", "escalation"],
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

    const payload = await response.json();
    const candidateText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) throw new Error("GEMINI_EMPTY_RESPONSE");

    return JSON.parse(candidateText) as SupportResponse;
  }
}

function provider(): AIProvider {
  return new GeminiProvider();
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = (await request.json()) as SupportRequest;
    const situation = sanitize(String(body.situation || ""));
    if (!situation || situation.length > 2000) {
      return json({ error: "Shkruani një situatë me më pak se 2000 shkronja." }, 400);
    }

    if (containsImmediateRisk(situation)) {
      return json({
        observation: "Kjo mund të jetë çështje sigurie dhe nuk duhet trajtuar vetëm nga asistenti.",
        actions: [
          "Siguroni praninë e një të rrituri përgjegjës pranë nxënësit.",
          "Aktivizoni menjëherë protokollin e mbrojtjes së shkollës.",
          "Kontaktoni shërbimet emergjente lokale nëse rreziku është i afërt.",
        ],
        observationCue: "Shënoni vetëm faktet me shkrim dhe kujt iu raportua situata.",
        escalation: "Ndiqni protokollin e shkollës për mbrojtje/emergjencë.",
      } satisfies SupportResponse);
    }

    return json(await provider().generateSupport(situation));
  } catch (error) {
    console.error("support function failed", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    const message = errMsg.includes("GEMINI_API_KEY_MISSING")
      ? "Çelësi GEMINI_API_KEY nuk është vendosur në Supabase Secrets."
      : `Asistenti nuk mundi të përgjigjet tani (${errMsg}). Provoni përsëri.`;
    return json({ error: message }, 503);
  }
});
