// Classifies failures from the NVIDIA NIM AI calls so the UI can show a
// meaningful popup instead of a raw stack trace. Kept free of React/sonner so
// it can be unit tested and reused on either side of the wire.

export type AiIssueKind =
  | "rate-limit"
  | "quota"
  | "auth"
  | "missing-key"
  | "timeout"
  | "network"
  | "server"
  | "bad-response"
  | "unknown";

export type AiIssue = {
  kind: AiIssueKind;
  title: string;
  hint: string;
  raw: string;
  retryable: boolean;
  retryAfterSec?: number;
};

const TITLES: Record<AiIssueKind, string> = {
  "rate-limit": "AI rate limit reached",
  quota: "AI quota exhausted",
  auth: "AI credentials rejected",
  "missing-key": "AI key not configured",
  timeout: "AI request timed out",
  network: "Can't reach the AI service",
  server: "AI service is having trouble",
  "bad-response": "Unexpected AI response",
  unknown: "AI request failed",
};

const HINTS: Record<AiIssueKind, string> = {
  "rate-limit": "NVIDIA NIM is throttling requests. Wait a moment, then retry.",
  quota: "Your NVIDIA NIM credits or quota are used up. Check account billing.",
  auth: "NVIDIA_API_KEY was rejected. Verify the key in your .env file.",
  "missing-key": "Add NVIDIA_API_KEY to .env to enable live AI responses.",
  timeout: "The model took too long to answer. Try again.",
  network: "Check the connection to integrate.api.nvidia.com and retry.",
  server: "NVIDIA NIM returned a server error. Retry in a moment.",
  "bad-response": "The model returned a response that could not be read. Retry.",
  unknown: "The AI request failed. Retry, or check the server logs.",
};

function messageOf(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (input instanceof Error) return (input.message || input.name || "").trim();
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record["message"] === "string") return record["message"].trim();
    if (typeof record["error"] === "string") return record["error"].trim();
    if (record["error"]) return messageOf(record["error"]);
  }
  return "";
}

function retryAfterOf(raw: string): number | undefined {
  const match = raw.match(/retry[- ]after[^0-9]{0,12}(\d{1,4})/i);
  if (!match?.[1]) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function statusOf(raw: string): number | undefined {
  // Prefer the explicit "NVIDIA API <status>" prefix, then a bare HTTP status.
  const explicit = raw.match(/(?:NVIDIA|API|HTTP|status)[^0-9]{0,6}(\d{3})/i);
  if (explicit?.[1]) return Number(explicit[1]);
  const bare = raw.match(/\b(4\d{2}|5\d{2})\b/);
  return bare?.[1] ? Number(bare[1]) : undefined;
}

export function classifyAiIssue(input: unknown): AiIssue {
  const raw = messageOf(input).slice(0, 300);
  const lower = raw.toLowerCase();
  const status = statusOf(raw);
  const retryAfterSec = retryAfterOf(raw);

  let kind: AiIssueKind = "unknown";

  if (/nvidia_api_key is not set|api key is not set|missing api key/.test(lower)) {
    kind = "missing-key";
  } else if (
    /insufficient[ _-]?quota|quota (?:exceeded|exhausted|reached)|credit balance|billing|payment required/.test(
      lower,
    ) ||
    status === 402
  ) {
    kind = "quota";
  } else if (
    /rate[ _-]?limit|too many requests|requests per (?:minute|second)|throttl/.test(lower) ||
    status === 429
  ) {
    kind = "rate-limit";
  } else if (
    /invalid api key|unauthorized|forbidden|authentication|invalid[ _-]?token|permission denied/.test(
      lower,
    ) ||
    status === 401 ||
    status === 403
  ) {
    kind = "auth";
  } else if (/timed out|timeout|abort(?:ed)?/.test(lower)) {
    kind = "timeout";
  } else if (
    /failed to fetch|fetch failed|network|econnrefused|econnreset|enotfound|socket|offline|dns/.test(
      lower,
    )
  ) {
    kind = "network";
  } else if (
    /non-json|empty answer|empty agent message|empty event report|no json object/.test(lower)
  ) {
    kind = "bad-response";
  } else if (status !== undefined && status >= 500) {
    kind = "server";
  }

  return {
    kind,
    title: TITLES[kind],
    hint: HINTS[kind],
    raw,
    retryable: kind !== "auth" && kind !== "missing-key",
    ...(retryAfterSec ? { retryAfterSec } : {}),
  };
}
