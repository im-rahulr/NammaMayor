import { createServerFn } from "@tanstack/react-start";

// NVIDIA NIM exposes an OpenAI-compatible API. Credentials stay on the server:
// this module is imported by a server function, so the key is never bundled
// into the client.
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const REQUEST_TIMEOUT_MS = 90_000;
const AGENT_TIMEOUT_MS = 30_000;
const MAX_QUESTION_CHARS = 4_000;
const MAX_SYSTEM_CHARS = 2_000;

// ─── Agent definitions ────────────────────────────────────────────────────────
// Each agent has a fixed role, rules, and a set of peers it can address.
// The ORCHESTRATOR agent is the supervisor; it never generates domain messages
// but validates consensus and authorises action plans.

export type AgentId = "prediction" | "FORECAST" | "MOBILITY" | "SAFETY" | "COMMS";

export type AgentMessage = {
  from: AgentId;
  to: AgentId;
  text: string;
  t: string;
};

export type AgentTurnResult = {
  messages: AgentMessage[];
  latencyMs: number;
};

// Ordered list of (from, to) pairs that define one conversation cycle.
// We rotate through this sequence so each turn is deterministic and sequential.
export const AGENT_TURN_ORDER: [AgentId, AgentId][] = [
  ["prediction", "FORECAST"],
  ["FORECAST", "MOBILITY"],
  ["MOBILITY", "SAFETY"],
  ["SAFETY", "COMMS"],
  ["COMMS", "prediction"],
];

// One system prompt per agent, encoding their domain rules.
const AGENT_SYSTEM_PROMPTS: Record<AgentId, string> = {
  prediction: [
    "You are the PREDICTION agent in the NammaMayor OS crisis command centre for Bengaluru, India.",
    "Your exclusive domain: real-time sensor analytics, rainfall gauge data, drain-capacity readings, CCTV feeds, and short-range hazard forecasting (next 30 min).",
    "Rules:",
    "1. Keep every reply to ONE concise operational sentence (max 25 words).",
    "2. Always cite a specific sensor ID, drain ID, gauge reading, or location name.",
    "3. Your only valid recipients are FORECAST and SAFETY.",
    "4. Never issue orders — only share data findings and readings.",
    "5. Never use generic filler; every message must contain a concrete number or measurement.",
  ].join("\n"),

  FORECAST: [
    "You are the FORECAST agent in the NammaMayor OS crisis command centre for Bengaluru, India.",
    "Your exclusive domain: hydrological and meteorological modelling — flood depth projections, plume dispersion, wind speed/direction forecasts, and corridor risk ratings.",
    "Rules:",
    "1. Keep every reply to ONE concise operational sentence (max 25 words).",
    "2. State a projected value (depth in metres, risk level HIGH/MED/LOW, minutes to impact).",
    "3. Your only valid recipients are MOBILITY and prediction.",
    "4. Never issue resource orders — only produce risk assessments and projections.",
    "5. Base your reply on what the sender told you; do not fabricate new sensor data.",
  ].join("\n"),

  MOBILITY: [
    "You are the MOBILITY agent in the NammaMayor OS crisis command centre for Bengaluru, India.",
    "Your exclusive domain: road diversions, BMTC bus re-routing, cordon placement, and travel time updates for Bengaluru's road network.",
    "Rules:",
    "1. Keep every reply to ONE concise operational sentence (max 25 words).",
    "2. Name a specific road, junction, or BMTC route number in every message.",
    "3. Your only valid recipients are FORECAST, SAFETY, and COMMS.",
    "4. Propose concrete diversion actions; do not merely acknowledge.",
    "5. Include a time delta (e.g. '+6 min', '−12 min') when referencing route changes.",
  ].join("\n"),

  SAFETY: [
    "You are the SAFETY agent in the NammaMayor OS crisis command centre for Bengaluru, India.",
    "Your exclusive domain: emergency resource dispatch (ambulances, fire tenders, rescue boats, police units), evacuation orders, and medical staging.",
    "Rules:",
    "1. Keep every reply to ONE concise operational sentence (max 25 words).",
    "2. State unit count, unit type, and staging location in every dispatch message.",
    "3. Your only valid recipients are MOBILITY, COMMS, and prediction.",
    "4. Always include an ETA in minutes.",
    "5. Prioritise life-safety actions before property or traffic actions.",
  ].join("\n"),

  COMMS: [
    "You are the COMMS agent in the NammaMayor OS crisis command centre for Bengaluru, India.",
    "Your exclusive domain: public alerts (SMS, PA, social media), multi-lingual broadcasts (EN/KN/HI), and coordination with media.",
    "Rules:",
    "1. Keep every reply to ONE concise operational sentence (max 25 words).",
    "2. Always state the broadcast channel, language(s), and estimated recipient count.",
    "3. Your only valid recipients are SAFETY and prediction.",
    "4. Never take physical action — only draft, approve, or send communications.",
    "5. If asking for approval, name exactly which agent should authorise.",
  ].join("\n"),
};

export const DEFAULT_QUESTION =
  "How should traffic be diverted if Silk Board junction is blocked due to waterlogging?";

export const DEFAULT_SYSTEM_PROMPT =
  "You are an expert operations intelligence advisor for Bengaluru City Command Center (NammaMayor OS). " +
  "Provide actionable, concise, and structured operational guidance for urban traffic management, " +
  "corridor diversions, emergency services clearance, and disaster response.";

export type QuestionResult = {
  model: string;
  content: string;
  reasoning: string;
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number } | null;
};

// Backwards compatibility alias
export type VisionResult = QuestionResult;

type NimPayload = {
  choices?: {
    message?: { content?: string | null; reasoning_content?: string | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
};

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : undefined;
}

function clampTokens(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 4_096;
  return Math.min(16_384, Math.max(256, Math.round(n)));
}

export const askQuestion = createServerFn({ method: "POST" })
  .validator(
    (
      input:
        | { question?: string; prompt?: string; systemPrompt?: string; maxTokens?: number }
        | undefined,
    ) => {
      // Support 'question' or fallback 'prompt'
      const rawQuestion = input?.question ?? input?.prompt;
      if (typeof rawQuestion !== "string" || !rawQuestion.trim()) {
        throw new Error("A question is required.");
      }
      const question = rawQuestion.trim().slice(0, MAX_QUESTION_CHARS);
      const systemPrompt =
        typeof input?.systemPrompt === "string" && input.systemPrompt.trim()
          ? input.systemPrompt.trim().slice(0, MAX_SYSTEM_CHARS)
          : DEFAULT_SYSTEM_PROMPT;
      return {
        question,
        systemPrompt,
        maxTokens: clampTokens(input?.maxTokens),
      };
    },
  )
  .handler(async ({ data }): Promise<QuestionResult> => {
    const apiKey = readEnv("NVIDIA_API_KEY");
    if (!apiKey) {
      throw new Error("NVIDIA_API_KEY is not set. Add it to .env (see .env.example).");
    }
    const baseUrl = (readEnv("NVIDIA_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = readEnv("NVIDIA_MODEL") ?? readEnv("NVIDIA_VISION_MODEL") ?? DEFAULT_MODEL;
    const started = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: data.systemPrompt,
            },
            {
              role: "user",
              content: data.question,
            },
          ],
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: data.maxTokens,
          chat_template_kwargs: { enable_thinking: true },
        }),
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(
          `NVIDIA API ${response.status}: ${body.slice(0, 400) || "no response body"}`,
        );
      }

      let payload: NimPayload;
      try {
        payload = JSON.parse(body) as NimPayload;
      } catch {
        throw new Error("NVIDIA API returned a non-JSON response.");
      }

      const message = payload.choices?.[0]?.message;
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      const reasoning =
        typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
      if (!content && !reasoning) throw new Error("NVIDIA API returned an empty answer.");

      return {
        model: payload.model ?? model,
        content,
        reasoning,
        latencyMs: Date.now() - started,
        usage: payload.usage
          ? {
              promptTokens: payload.usage.prompt_tokens ?? 0,
              completionTokens: payload.usage.completion_tokens ?? 0,
            }
          : null,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("NVIDIA API timed out after 90 seconds. Please try again.");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });

// Aliases for backwards compatibility
export const describeImage = askQuestion;
export const DEFAULT_VISION_PROMPT = DEFAULT_QUESTION;

// ─── Multi-agent chat server function ─────────────────────────────────────────
// Runs one agent-to-agent turn via the real NVIDIA NIM API.
// The caller supplies:
//   - turnIndex  : which step in AGENT_TURN_ORDER to execute (0-4, then wraps)
//   - lastMessage: the text the previous agent sent (used as context)
//   - mode       : current incident mode so agents stay on topic

async function nimComplete(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  baseUrl: string,
  model: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.75,
        top_p: 0.95,
        max_tokens: 120,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`NVIDIA API ${response.status}: ${body.slice(0, 200) || "no body"}`);
    }

    let payload: NimPayload;
    try {
      payload = JSON.parse(body) as NimPayload;
    } catch {
      throw new Error("NVIDIA API returned a non-JSON response.");
    }

    const content = payload.choices?.[0]?.message?.content ?? "";
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("NVIDIA API returned an empty agent message.");
    }
    // Strip any self-referencing prefix like "prediction: " the model may add
    return content
      .trim()
      .replace(/^[A-Za-z]+:\s*/, "")
      .trim();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Agent turn timed out (30 s).");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Mode-specific incident context injected into every user prompt
const MODE_CONTEXT: Record<string, string> = {
  idle: "Current status: all-clear, routine monitoring.",
  storm:
    "ACTIVE INCIDENT: Severe rainfall 48 mm/h over Silk Board catchment. Flood risk HIGH. ORR eastbound at risk.",
  gas: "ACTIVE INCIDENT: Methane sensor spike (4.1% LEL) near HSR Sector 2. Plume drifting NE at 3 m/s toward Agara.",
  road: "ACTIVE INCIDENT: Road closure on Outer Ring Road Eastbound near Agara Junction. Heavy diversion traffic expected.",
};

export const agentChat = createServerFn({ method: "POST" })
  .validator(
    (
      input:
        | {
            turnIndex?: number;
            lastMessage?: string;
            mode?: string;
          }
        | undefined,
    ) => ({
      turnIndex: Math.max(0, Math.round(Number(input?.turnIndex ?? 0))) % AGENT_TURN_ORDER.length,
      lastMessage:
        typeof input?.lastMessage === "string" ? input.lastMessage.trim().slice(0, 300) : "",
      mode: typeof input?.mode === "string" ? input.mode : "idle",
    }),
  )
  .handler(async ({ data }): Promise<AgentTurnResult> => {
    const apiKey = readEnv("NVIDIA_API_KEY");
    if (!apiKey) {
      throw new Error("NVIDIA_API_KEY is not set. Add it to .env (see .env.example).");
    }
    const baseUrl = (readEnv("NVIDIA_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = readEnv("NVIDIA_MODEL") ?? readEnv("NVIDIA_VISION_MODEL") ?? DEFAULT_MODEL;

    const [from, to] = AGENT_TURN_ORDER[data.turnIndex]!;
    const systemPrompt = AGENT_SYSTEM_PROMPTS[from];
    const incidentCtx = MODE_CONTEXT[data.mode] ?? MODE_CONTEXT["idle"]!;

    // Build the user prompt seen by the FROM agent
    const userPrompt = data.lastMessage
      ? `[${incidentCtx}]\n\n${to} is waiting for your update. The last message in the channel was: "${data.lastMessage}"\n\nRespond as ${from}, addressing ${to} with a single operational sentence.`
      : `[${incidentCtx}]\n\nAddress ${to} with your first operational update. One sentence only.`;

    const started = Date.now();
    const text = await nimComplete(systemPrompt, userPrompt, apiKey, baseUrl, model);
    const latencyMs = Date.now() - started;
    const t = new Date().toLocaleTimeString("en-GB", { hour12: false });

    return {
      messages: [{ from, to, text, t }],
      latencyMs,
    };
  });
