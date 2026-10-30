import { createServerFn } from "@tanstack/react-start";

import {
  estimateEventImpact,
  riskLevelFor,
  EVENT_CATEGORIES,
  EVENT_ZONES,
  RISK_LEVELS,
  type CityEvent,
  type EventCategory,
  type EventInflowPhase,
  type EventImpact,
  type EventZone,
  type RiskLevel,
} from "./city-events";

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
  /** True when the live model call failed and a local fallback was used. */
  degraded?: boolean;
  /** Human-readable reason for the fallback, surfaced as a UI popup. */
  notice?: string;
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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "unknown error";
}

// Builds an Error whose message keeps the HTTP status (and Retry-After when the
// provider sends one) so the client can classify it and pop the right notice.
function httpError(status: number, body: string, retryAfter: string | null): Error {
  const seconds = retryAfter && /^\d+$/.test(retryAfter.trim()) ? retryAfter.trim() : null;
  const retry = seconds ? ` (retry after ${seconds}s)` : "";
  return new Error(`NVIDIA API ${status}${retry}: ${body.slice(0, 400) || "no response body"}`);
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
        throw httpError(response.status, body, response.headers.get("retry-after"));
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
      throw httpError(response.status, body, response.headers.get("retry-after"));
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
    // Strip any self-referencing prefix like "prediction: " or
    // "FORECAST to MOBILITY:" the model may add.
    return content
      .trim()
      .replace(/^[A-Za-z]+(?:\s*(?:→|->|to)\s*[A-Za-z]+)?:\s*/, "")
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
  idle: "Current status: all-clear, routine monitoring across all zones.",
  storm:
    "ACTIVE INCIDENT: Severe rainfall 48 mm/h over Silk Board catchment. Flood risk HIGH. ORR eastbound at risk.",
  gas: "ACTIVE INCIDENT: Methane sensor spike (4.1% LEL) near HSR Sector 2. Plume drifting NE at 3 m/s toward Agara.",
  road: "ACTIVE INCIDENT: Road closure on Outer Ring Road Eastbound near Agara Junction. Heavy diversion traffic expected.",
};

export type MarkedEventInput = {
  type?: string;
  typeName?: string;
  locationName?: string;
  lat?: number;
  lng?: number;
  severity?: string;
  description?: string;
};

// ─── Event-type playbooks ─────────────────────────────────────────────────────
// Each marked map event re-frames the agents' domains. Without this a collision
// thread inherits the flood-centric defaults and the agents end up discussing
// rainfall gauges instead of the crash. `focus` steers the live model prompt and
// `fallback` is used verbatim when the NVIDIA API is offline or rate-limited.

type EventPlaybook = {
  label: string;
  focus: Record<AgentId, string>;
  fallback: Record<AgentId, string>;
};

const EVENT_PLAYBOOKS: Record<string, EventPlaybook> = {
  accident: {
    label: "major road collision",
    focus: {
      prediction:
        "CCTV and vehicle-occupancy evidence of the collision — vehicles involved, lanes blocked, debris field and secondary-collision risk",
      FORECAST:
        "queue growth, congestion spillback minutes and secondary-crash probability — never rainfall or hydrology",
      MOBILITY: "lane closures, contraflow and BMTC diversions around the collision site",
      SAFETY: "ambulance, trauma-care, extrication and police units for casualties",
      COMMS: "a public collision advisory naming the junction and alternate routes",
    },
    fallback: {
      prediction:
        "CCTV node #BLR-{node} confirms a {sev} multi-vehicle collision at {loc}; 2 of 3 lanes blocked with debris across the carriageway.",
      FORECAST:
        "Queue spillback from {loc} reaches 1.4 km in 18 minutes; secondary-collision risk HIGH on the approach.",
      MOBILITY:
        "Closing the two blocked lanes at {loc}; diverting BMTC Route 335 via Residency Road and MG Road (+8 min).",
      SAFETY:
        "Dispatched 2 EMS ambulances, 1 rescue tender and 2 police units to {loc}; extrication team ETA 4 minutes.",
      COMMS:
        "Issued collision advisory in Kannada and English to 12,400 commuters via cell broadcast and VMS boards around {loc}.",
    },
  },
  flood: {
    label: "flood / inundation",
    focus: {
      prediction:
        "rainfall gauge readings, stormwater drain capacity, standing-water depth and CCTV evidence of inundation",
      FORECAST: "flood-depth projections, drain overflow timing and minutes until peak inundation",
      MOBILITY:
        "underpass closures, waterlogging diversions and BMTC rerouting around the flooded stretch",
      SAFETY: "dewatering pumps, rescue boats and evacuation of stranded vehicles",
      COMMS: "a public flood advisory naming the junction and alternate routes",
    },
    fallback: {
      prediction:
        "Gauge #{node} at {loc} reads 52 mm/hr; stormwater drain DRN-042 is at 97% capacity with 0.4 m standing water.",
      FORECAST:
        "Waterlogging at {loc} reaches 0.65 m in 20 minutes; flood risk {sev} across the catchment.",
      MOBILITY:
        "Closing the {loc} underpass; diverting BMTC Route 335 via 100ft Inner Ring Road (+11 min).",
      SAFETY: "Deploying 3 dewatering pumps and 2 rescue boats to {loc}; staging ETA 4 minutes.",
      COMMS:
        "Issued flash-flood evacuation advisory in Kannada and English to 28,000 residents around {loc}.",
    },
  },
  gas: {
    label: "gas leak / hazmat",
    focus: {
      prediction:
        "methane/LEL sensor readings, wind vector and CCTV confirmation of the leak source",
      FORECAST:
        "plume dispersion direction, downwind exposure radius and minutes to the nearest cluster",
      MOBILITY: "road barricades and BMTC diversions around the exclusion zone",
      SAFETY: "fire tenders, hazmat suppression and shelter-in-place enforcement",
      COMMS: "a shelter-in-place broadcast in EN/KN/HI to residents downwind",
    },
    fallback: {
      prediction:
        "Methane array at {loc} confirms 4.3% LEL; wind vector NE at 3 m/s from the breach.",
      FORECAST:
        "Vapour plume from {loc} expands 600 m northeast toward the nearest residential cluster in 22 minutes.",
      MOBILITY:
        "Barricading all approaches to {loc}; rerouting BMTC Route 343 via 27th Main (+6 min).",
      SAFETY:
        "Dispatched 2 fire tenders and a hazmat unit to {loc}; exclusion cordon ETA 3 minutes.",
      COMMS: "Shelter-in-place order issued in EN/KN/HI to 9,600 residents downwind of {loc}.",
    },
  },
  roadblock: {
    label: "road cave-in / block",
    focus: {
      prediction:
        "pavement-subsidence sensor readings, CCTV of the cave-in and the exact closed carriageway",
      FORECAST: "queue growth and minutes until congestion spills onto parallel arterials",
      MOBILITY: "contraflow and BMTC rerouting around the closed thoroughfare",
      SAFETY: "barricades, police cordon and NDRF/crane support at the sinkhole",
      COMMS: "a road-closure advisory with alternate routes",
    },
    fallback: {
      prediction:
        "Pavement sensor #{node} at {loc} shows 38 mm subsidence; CCTV confirms a 6 m sinkhole across the northbound lanes.",
      FORECAST:
        "Queue spillback from {loc} reaches 2.1 km in 25 minutes; adjacent arterials saturate within 40 minutes.",
      MOBILITY:
        "Closing {loc} to all traffic; contraflow on the service road and BMTC Route 500 diverted (+14 min).",
      SAFETY: "Cordoned {loc} with 2 police units and an NDRF assessment team; ETA 6 minutes.",
      COMMS: "Road-closure advisory issued to 18,300 commuters with alternate routes around {loc}.",
    },
  },
  fire: {
    label: "fire / industrial hazard",
    focus: {
      prediction:
        "thermal sensor and CCTV confirmation of the fire front, wind speed and structure involvement",
      FORECAST: "flame spread direction, particulate plume radius and downwind exposure in minutes",
      MOBILITY: "road closures and BMTC diversions around the fire perimeter",
      SAFETY: "fire tenders, water tankers and evacuation of adjacent buildings",
      COMMS: "a smoke-hazard advisory and evacuation broadcast",
    },
    fallback: {
      prediction:
        "Thermal sensor #{node} at {loc} reads 640°C; CCTV confirms fire across two structures with wind at 4 m/s.",
      FORECAST:
        "Flame front at {loc} spreads 300 m downwind in 15 minutes; smoke plume risk {sev}.",
      MOBILITY:
        "Closing all roads within 500 m of {loc}; BMTC Route 356 diverted via Old Madras Road (+9 min).",
      SAFETY:
        "Dispatched 4 fire tenders and 2 water tankers to {loc}; evacuation of adjacent blocks ETA 5 minutes.",
      COMMS:
        "Smoke-hazard and evacuation broadcast issued in EN/KN/HI to 14,700 residents near {loc}.",
    },
  },
  medical: {
    label: "mass casualty / medical surge",
    focus: {
      prediction:
        "casualty-count telemetry, hospital intake and CCTV confirmation of the mass-casualty scene",
      FORECAST:
        "casualty surge projection, triage load and minutes until hospital capacity pressure",
      MOBILITY: "ambulance corridor clearance and BMTC diversions around the casualty scene",
      SAFETY: "triage teams, ambulance convoys and hospital bed allocation",
      COMMS: "a public advisory for blood donation and hospital diversion",
    },
    fallback: {
      prediction:
        "Casualty telemetry at {loc} reports 14 injured; CCTV confirms a mass-gathering surge at the scene.",
      FORECAST:
        "Casualty surge from {loc} reaches 26 patients within 30 minutes; nearest trauma centre at 88% capacity.",
      MOBILITY:
        "Clearing an ambulance corridor on the {loc} approach; BMTC Route 342 diverted (+5 min).",
      SAFETY:
        "Dispatched 6 ambulances and 2 triage teams to {loc}; hospital bed allocation confirmed, ETA 4 minutes.",
      COMMS:
        "Public advisory issued in Kannada and English directing donors to Victoria Hospital; 21,000 reached.",
    },
  },
};

function eventPlaybook(ev: MarkedEventInput | null): EventPlaybook | null {
  if (!ev) return null;
  return EVENT_PLAYBOOKS[(ev.type ?? "").toLowerCase()] ?? null;
}

function eventNodeId(ev: MarkedEventInput): number {
  const lat = typeof ev.lat === "number" ? ev.lat : 0;
  return (Math.abs(Math.round(lat * 1000)) % 900) + 100;
}

// Appends a high-priority incident override to the agent's base role so a
// collision, fire or gas event never inherits the flood-only vocabulary.
function buildAgentSystemPrompt(from: AgentId, ev: MarkedEventInput | null): string {
  const base = AGENT_SYSTEM_PROMPTS[from];
  if (!ev || !ev.locationName) return base;

  const playbook = eventPlaybook(ev);
  const label = playbook?.label ?? (ev.typeName || ev.type || "live incident").toLowerCase();
  const severity = ev.severity || "CRITICAL";
  const focus = playbook?.focus[from] ?? `the ${label} at ${ev.locationName}`;

  return [
    base,
    "",
    "── LIVE INCIDENT OVERRIDE (highest priority) ──",
    `Active incident: ${label.toUpperCase()} at ${ev.locationName}. Severity: ${severity}.`,
    `Your focus for this incident: ${focus}.`,
    "Rainfall, drainage and hydrology are IRRELEVANT unless the incident itself is a flood — never mention them.",
    `Every message must name the ${label} and ${ev.locationName}.`,
  ].join("\n");
}

// Domain-aware fallback responses when API is slow, offline, or rate-limited
function generateDomainFallback(
  from: AgentId,
  to: AgentId,
  ev: MarkedEventInput | null,
  mode: string,
): string {
  if (ev && ev.locationName) {
    const loc = ev.locationName;
    const kind = ev.typeName || ev.type || "incident";
    const sev = ev.severity || "CRITICAL";
    const playbook = eventPlaybook(ev);

    if (playbook) {
      return playbook.fallback[from]
        .replace(/\{loc\}/g, loc)
        .replace(/\{sev\}/g, sev)
        .replace(/\{kind\}/g, kind)
        .replace(/\{node\}/g, String(eventNodeId(ev)));
    }

    switch (from) {
      case "prediction":
        return `Sensor Node #BLR-${eventNodeId(ev)} at ${loc} confirms ${kind} anomaly; CCTV telemetry shows threat level ${sev}.`;
      case "FORECAST":
        return `Impact model projects a 450 m escalation perimeter around ${loc} over the next 40 minutes; risk ${sev}.`;
      case "MOBILITY":
        return `Activated detour cordon around ${loc}; diverting arterial traffic and BMTC fleet via parallel corridor (+7 min delta).`;
      case "SAFETY":
        return `Dispatched 2 EMS ambulances and 1 quick response team to ${loc}; staging ETA 5 minutes at perimeter.`;
      case "COMMS":
        return `Transmitted trilingual emergency cell broadcast (EN/KN/HI) to 15,200 mobile users in ${loc} zone.`;
    }
  }

  // Fallbacks for standard modes
  if (mode === "storm") {
    switch (from) {
      case "prediction":
        return "Rainfall gauge at Silk Board logging 52 mm/h; drain telemetry at 97% capacity.";
      case "FORECAST":
        return "Waterlogging projection at Silk Board junction stands at 0.65m within 20 minutes; risk HIGH.";
      case "MOBILITY":
        return "Closing ORR underpass; rerouting eastbound vehicles via 100ft Inner Ring Road (+11 min).";
      case "SAFETY":
        return "Deploying 3 dewatering pumps and 2 rescue boats to Silk Board staging area; ETA 4 min.";
      case "COMMS":
        return "Broadcasting flash-flood evacuation advisory via BBMP WhatsApp and local PA to 28,000 residents.";
    }
  }

  if (mode === "gas") {
    switch (from) {
      case "prediction":
        return "Methane detector array at HSR Sector 2 confirms concentration spike of 4.3% LEL.";
      case "FORECAST":
        return "Atmospheric dispersion model shows vapor plume expanding 600m northeast toward Agara.";
      case "MOBILITY":
        return "Barricading 27th Main HSR and 14th Main junction; re-routing BMTC Route 343 (+6 min).";
      case "SAFETY":
        return "Dispatched 2 fire tenders and hazmat suppression unit to Sector 2 perimeter; ETA 3 min.";
      case "COMMS":
        return "Issued immediate shelter-in-place and window-seal order in English and Kannada across HSR Sector 2.";
    }
  }

  // Idle routine monitoring
  switch (from) {
    case "prediction":
      return "All 14 CCTV streams and 32 IoT storm drains reporting normal operational baselines.";
    case "FORECAST":
      return "Meteorological radar indicates dry conditions and zero storm cells within 40 km.";
    case "MOBILITY":
      return "Corridor throughput on Outer Ring Road and Hosur Road moving at steady 38 km/h.";
    case "SAFETY":
      return "All 20 emergency ambulances and fire stations on routine standby at primary stations.";
    case "COMMS":
      return "Public channels all-clear; no emergency advisories or road closure alerts active.";
  }
}

export const agentChat = createServerFn({ method: "POST" })
  .validator(
    (
      input:
        | {
            turnIndex?: number;
            lastMessage?: string;
            mode?: string;
            markedEvent?: MarkedEventInput | null;
          }
        | undefined,
    ) => ({
      turnIndex: Math.max(0, Math.round(Number(input?.turnIndex ?? 0))) % AGENT_TURN_ORDER.length,
      lastMessage:
        typeof input?.lastMessage === "string" ? input.lastMessage.trim().slice(0, 300) : "",
      mode: typeof input?.mode === "string" ? input.mode : "idle",
      markedEvent: input?.markedEvent ?? null,
    }),
  )
  .handler(async ({ data }): Promise<AgentTurnResult> => {
    const apiKey = readEnv("NVIDIA_API_KEY");
    const baseUrl = (readEnv("NVIDIA_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = readEnv("NVIDIA_MODEL") ?? readEnv("NVIDIA_VISION_MODEL") ?? DEFAULT_MODEL;

    const [from, to] = AGENT_TURN_ORDER[data.turnIndex]!;
    const systemPrompt = buildAgentSystemPrompt(from, data.markedEvent);

    let incidentCtx = MODE_CONTEXT[data.mode] ?? MODE_CONTEXT["idle"]!;
    if (data.markedEvent && data.markedEvent.locationName) {
      const ev = data.markedEvent;
      const label = eventPlaybook(ev)?.label ?? ev.typeName ?? ev.type ?? "emergency";
      incidentCtx = `ACTIVE MARKED MAP EVENT: [${(ev.typeName || ev.type || "EMERGENCY").toUpperCase()} — ${label.toUpperCase()}] at ${ev.locationName} (Coords: ${ev.lat?.toFixed(4)}, ${ev.lng?.toFixed(4)}). Severity: ${ev.severity ?? "CRITICAL"}. Description: ${ev.description || "Active field incident marked on Bengaluru live crisis map"}. Stay on this event only — do not drift to unrelated hazards.`;
    }

    // Build the user prompt seen by the FROM agent
    const openingLine =
      data.markedEvent?.locationName && (data.markedEvent.typeName || data.markedEvent.type)
        ? `Open the incident thread by confirming the ${data.markedEvent.typeName || data.markedEvent.type} at ${data.markedEvent.locationName}, then state your first concrete finding or action.`
        : "State your first operational finding or action for this incident.";

    const userPrompt = data.lastMessage
      ? `[${incidentCtx}]\n\n${to} is waiting for your update. The last message in the channel was: "${data.lastMessage}"\n\nRespond as ${from}, addressing ${to} with a single operational sentence about this incident.`
      : `[${incidentCtx}]\n\n${openingLine} Address ${to}. One sentence only.`;

    const started = Date.now();
    let text = "";
    let degraded = false;
    let notice: string | undefined;

    if (apiKey) {
      try {
        text = await nimComplete(systemPrompt, userPrompt, apiKey, baseUrl, model);
      } catch (error) {
        // Fall back gracefully, but tell the client so it can show a popup.
        degraded = true;
        notice = `NVIDIA NIM agent call failed (${errorMessage(error)}) — showing a local fallback response.`;
        text = generateDomainFallback(from, to, data.markedEvent, data.mode);
      }
    } else {
      degraded = true;
      notice =
        "NVIDIA_API_KEY is not set — showing local fallback responses instead of live AI agents.";
      text = generateDomainFallback(from, to, data.markedEvent, data.mode);
    }

    const latencyMs = Date.now() - started;
    const t = new Date().toLocaleTimeString("en-GB", { hour12: false });

    return {
      messages: [{ from, to, text, t }],
      latencyMs,
      ...(degraded && notice ? { degraded, notice: notice.slice(0, 300) } : {}),
    };
  });

// ─── Scheduled-event impact forecasting ──────────────────────────────────────
// Given a scheduled city event (match, concert, marathon…), forecast crowd
// inflow and road-network load. The model is asked for strict JSON so the UI can
// render structured cards; every field falls back to the deterministic
// estimator in city-events.ts when the API is unavailable or malformed.

const EVENT_TEXT_MAX = 160;

const EVENT_SYSTEM_PROMPT = [
  "You are the city operations intelligence advisor for Bengaluru City Command Center (NammaMayor OS).",
  "You forecast crowd and traffic impact for scheduled city events and produce an actionable pre-event operations brief.",
  "Rules:",
  "1. Reply with a single JSON object only — no markdown fences, no commentary.",
  "2. Ground every number in the supplied attendance, capacity, venue and arterial context; keep estimates plausible for Bengaluru.",
  "3. inflow[].pct values must sum to 100 and addedMin values are integer minutes of delay.",
  "4. risk.score is 0-100 and must match risk.level (LOW <45, MODERATE 45-64, HIGH 65-84, SEVERE >=85).",
  "5. concerns and actions must name specific roads, gates, or agencies — never generic filler.",
].join("\n");

const EVENT_JSON_SCHEMA = `{
  "crowd": { "expected": number, "peakConcurrent": number, "gatePressure": string, "inflow": [{ "phase": string, "pct": number }] },
  "traffic": { "addedPcuPerHour": number, "parkingDemand": number, "corridors": [{ "corridor": string, "addedMin": number, "note": string }], "closures": [string] },
  "transit": { "metroSurge": string, "bmtc": string },
  "risk": { "score": number, "level": "LOW" | "MODERATE" | "HIGH" | "SEVERE", "concerns": [string], "actions": [string] },
  "summary": string
}`;

type EventEnvelope = { data?: unknown };

type InflowPayload = { phase?: unknown; pct?: unknown };
type CorridorPayload = { corridor?: unknown; addedMin?: unknown; note?: unknown };
type CrowdPayload = {
  expected?: unknown;
  peakConcurrent?: unknown;
  gatePressure?: unknown;
  inflow?: unknown;
};
type TrafficPayload = {
  addedPcuPerHour?: unknown;
  parkingDemand?: unknown;
  corridors?: unknown;
  closures?: unknown;
};
type TransitPayload = { metroSurge?: unknown; bmtc?: unknown };
type RiskPayload = {
  score?: unknown;
  level?: unknown;
  concerns?: unknown;
  actions?: unknown;
};
type AgentEventReport = {
  crowd?: unknown;
  traffic?: unknown;
  transit?: unknown;
  risk?: unknown;
  summary?: unknown;
};

const asObject = <T extends object>(value: unknown): T =>
  (value && typeof value === "object" ? value : {}) as T;

function eventText(value: unknown, max = EVENT_TEXT_MAX): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function eventNumber(value: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function eventStringList(value: unknown, fallback: string[], max = 6): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .map((item) => eventText(item, 240))
    .filter(Boolean)
    .slice(0, max);
  return items.length ? items : fallback;
}

// Accepts either the raw payload or a `{ data }` envelope so the function can be
// exercised directly in tests.
function normalizeEvent(input: unknown): CityEvent {
  const envelope = asObject<EventEnvelope>(input);
  const raw = asObject<Partial<CityEvent>>("data" in envelope ? envelope.data : input);

  const title = eventText(raw.title);
  if (!title) throw new Error("An event title is required.");

  const category = EVENT_CATEGORIES.includes(raw.category as EventCategory)
    ? (raw.category as EventCategory)
    : "cultural";
  const zone = EVENT_ZONES.includes(raw.zone as EventZone) ? (raw.zone as EventZone) : "Central";

  const arterials = Array.isArray(raw.nearbyArterials)
    ? raw.nearbyArterials
        .map((road) => eventText(road, 80))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  const now = Date.now();
  return {
    id: eventText(raw.id, 80) || "event",
    title,
    category,
    venue: eventText(raw.venue) || "Bengaluru venue",
    locationName: eventText(raw.locationName) || eventText(raw.venue) || "Bengaluru",
    zone,
    lat: eventNumber(raw.lat, 12.9716, -90, 90),
    lng: eventNumber(raw.lng, 77.5946, -180, 180),
    startsAt: eventText(raw.startsAt, 40) || new Date(now).toISOString(),
    endsAt: eventText(raw.endsAt, 40) || new Date(now + 3 * 60 * 60 * 1000).toISOString(),
    expectedAttendance: eventNumber(raw.expectedAttendance, 10_000, 0, 5_000_000),
    venueCapacity: Math.max(1, eventNumber(raw.venueCapacity, 15_000, 1, 5_000_000)),
    radiusM: eventNumber(raw.radiusM, 800, 100, 5_000),
    nearbyArterials: arterials.length ? arterials : ["Primary arterial"],
    transitHub: eventText(raw.transitHub, 120) || "nearest Metro station",
    notes: eventText(raw.notes, 400),
  };
}

function extractJsonObject(content: string): unknown {
  const cleaned = content
    .replace(/```json/gi, "```")
    .replace(/```/g, " ")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response contained no JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function mergeImpact(fallback: EventImpact, payload: unknown): EventImpact {
  const root = asObject<AgentEventReport>(payload);
  const crowd = asObject<CrowdPayload>(root.crowd);
  const traffic = asObject<TrafficPayload>(root.traffic);
  const transit = asObject<TransitPayload>(root.transit);
  const risk = asObject<RiskPayload>(root.risk);

  const expected = eventNumber(crowd.expected, fallback.crowd.expected, 0, 5_000_000);

  const inflowRaw = Array.isArray(crowd.inflow) ? crowd.inflow : [];
  const inflow: EventInflowPhase[] = inflowRaw
    .map((item) => {
      const rec = asObject<InflowPayload>(item);
      const phase = eventText(rec.phase, 24);
      const pct = eventNumber(rec.pct, 0, 0, 100);
      return phase && pct > 0 ? { phase, pct, people: Math.round((expected * pct) / 100) } : null;
    })
    .filter((phase): phase is EventInflowPhase => phase !== null)
    .slice(0, 5);

  const corridorsRaw = Array.isArray(traffic.corridors) ? traffic.corridors : [];
  const corridors = corridorsRaw
    .map((item) => {
      const rec = asObject<CorridorPayload>(item);
      const corridor = eventText(rec.corridor, 80);
      if (!corridor) return null;
      return {
        corridor,
        addedMin: eventNumber(rec.addedMin, 5, 0, 240),
        note: eventText(rec.note, 160) || "Modelled corridor pressure",
      };
    })
    .filter((item): item is { corridor: string; addedMin: number; note: string } => item !== null)
    .slice(0, 5);

  const score = eventNumber(risk.score, fallback.risk.score, 0, 100);
  const level: RiskLevel = RISK_LEVELS.includes(risk.level as RiskLevel)
    ? (risk.level as RiskLevel)
    : riskLevelFor(score);

  return {
    source: "agent",
    crowd: {
      expected,
      peakConcurrent: eventNumber(
        crowd.peakConcurrent,
        fallback.crowd.peakConcurrent,
        0,
        5_000_000,
      ),
      gatePressure: eventText(crowd.gatePressure, 240) || fallback.crowd.gatePressure,
      inflow: inflow.length ? inflow : fallback.crowd.inflow,
    },
    traffic: {
      addedPcuPerHour: eventNumber(
        traffic.addedPcuPerHour,
        fallback.traffic.addedPcuPerHour,
        0,
        500_000,
      ),
      parkingDemand: eventNumber(traffic.parkingDemand, fallback.traffic.parkingDemand, 0, 500_000),
      corridors: corridors.length ? corridors : fallback.traffic.corridors,
      closures: eventStringList(traffic.closures, fallback.traffic.closures, 4),
    },
    transit: {
      metroSurge: eventText(transit.metroSurge, 220) || fallback.transit.metroSurge,
      bmtc: eventText(transit.bmtc, 220) || fallback.transit.bmtc,
    },
    risk: {
      score,
      level,
      concerns: eventStringList(risk.concerns, fallback.risk.concerns),
      actions: eventStringList(risk.actions, fallback.risk.actions),
    },
    summary: eventText(root.summary, 400) || fallback.summary,
  };
}

export type EventImpactResult = EventImpact & {
  model: string;
  latencyMs: number;
  notice?: string;
};

export const predictEventImpact = createServerFn({ method: "POST" })
  .validator((input: unknown) => normalizeEvent(input))
  .handler(async ({ data: event }): Promise<EventImpactResult> => {
    const fallback = estimateEventImpact(event);
    const apiKey = readEnv("NVIDIA_API_KEY");
    const baseUrl = (readEnv("NVIDIA_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const model = readEnv("NVIDIA_MODEL") ?? DEFAULT_MODEL;

    if (!apiKey) {
      return {
        ...fallback,
        model: "deterministic-model",
        latencyMs: 0,
        notice:
          "NVIDIA_API_KEY is not set — showing the deterministic model estimate instead of an AI agent report.",
      };
    }

    const userPrompt = [
      `Event: ${event.title} (${event.category})`,
      `Venue: ${event.venue} — ${event.locationName}, ${event.zone} zone, Bengaluru`,
      `Coordinates: ${event.lat.toFixed(4)}, ${event.lng.toFixed(4)}`,
      `Scheduled: ${event.startsAt} → ${event.endsAt} (IST)`,
      `Expected attendance: ${event.expectedAttendance} of ${event.venueCapacity} capacity`,
      `Modelled impact perimeter: ${event.radiusM} m`,
      `Roads under pressure: ${event.nearbyArterials.join(", ")}`,
      `Nearest mass transit: ${event.transitHub}`,
      event.notes ? `Operator notes: ${event.notes}` : "",
      "",
      "Return JSON with exactly this shape:",
      EVENT_JSON_SCHEMA,
    ]
      .filter(Boolean)
      .join("\n");

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
            { role: "system", content: EVENT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.4,
          top_p: 0.9,
          max_tokens: 1_400,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });

      const body = await response.text();
      if (!response.ok) {
        throw httpError(response.status, body, response.headers.get("retry-after"));
      }

      let payload: NimPayload;
      try {
        payload = JSON.parse(body) as NimPayload;
      } catch {
        throw new Error("NVIDIA API returned a non-JSON response.");
      }

      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("NVIDIA API returned an empty event report.");
      }

      return {
        ...mergeImpact(fallback, extractJsonObject(content)),
        model: payload.model ?? model,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "AbortError"
          ? "request timed out"
          : errorMessage(error);
      return {
        ...fallback,
        model: "deterministic-model",
        latencyMs: Date.now() - started,
        notice: `AI report unavailable (${reason.slice(0, 200)}) — showing the deterministic model estimate.`,
      };
    } finally {
      clearTimeout(timer);
    }
  });
