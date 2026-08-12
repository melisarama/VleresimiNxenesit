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

class OpenAIProvider implements AIProvider {
  async generateSupport(input: string): Promise<SupportResponse> {
    const apiKey = env("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL") || "gpt-5";
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions:
          "Ti je asistent pedagogjik për mësimdhënës në Kosovë. Përgjigju vetëm në shqip. Mos diagnostiko, mos kërko të dhëna identifikuese dhe mos zëvendëso protokollet e shkollës. Jep hapa praktikë, të shkurtër dhe mbështetës për klasë.",
        input,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "pedagogical_support",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["observation", "actions", "observationCue", "escalation"],
              properties: {
                observation: { type: "string" },
                actions: {
                  type: "array",
                  minItems: 3,
                  maxItems: 3,
                  items: { type: "string" },
                },
                observationCue: { type: "string" },
                escalation: { type: "string" },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`OPENAI_${response.status}`);
    }

    const payload = await response.json();
    const outputText =
      payload.output_text ??
      payload.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? [])
        .map((content: { text?: string }) => content.text)
        .filter(Boolean)
        .join("\n");

    if (!outputText) throw new Error("OPENAI_EMPTY_RESPONSE");
    return JSON.parse(outputText) as SupportResponse;
  }
}

function provider(): AIProvider {
  const providerName = Deno.env.get("AI_PROVIDER") || "openai";
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
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    await requireTeacher(request);
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
        observationCue: "Shënoni vetëm faktet e vëzhguara dhe kujt iu raportua situata.",
        escalation: "Ndiqni protokollin e shkollës për mbrojtje/emergjencë.",
      } satisfies SupportResponse);
    }

    return json(await provider().generateSupport(situation));
  } catch (error) {
    console.error("support function failed", error);
    const message = error instanceof Error && error.message === "UNAUTHORIZED"
      ? "Nuk keni qasje në këtë asistent."
      : "Asistenti nuk mundi të përgjigjet tani. Provoni përsëri.";
    return json({ error: message }, error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 503);
  }
});
