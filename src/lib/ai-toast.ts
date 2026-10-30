// Client-side popup for AI failures (rate limits, quota, timeouts, missing key…).
// Every AI entry point funnels through notifyAiIssue so the user always sees a
// clear toast instead of a silent fallback.

import { toast } from "sonner";

import { classifyAiIssue, type AiIssue } from "./ai-errors";

const DEFAULT_COOLDOWN_MS = 20_000;
const lastShownAt = new Map<string, number>();

export type NotifyAiIssueOptions = {
  /** Retry callback shown as the toast action. */
  retry?: () => void;
  /** Minimum gap before the same issue can pop again (background loops use a longer gap). */
  cooldownMs?: number;
};

function descriptionFor(issue: AiIssue): string {
  const hint =
    issue.kind === "rate-limit" && issue.retryAfterSec
      ? `NVIDIA NIM is throttling requests. Retry in ${issue.retryAfterSec}s.`
      : issue.hint;
  const detail = issue.raw && issue.raw !== hint ? ` ${issue.raw.slice(0, 180)}` : "";
  return `${hint}${detail}`;
}

/**
 * Shows an error popup for any AI failure. Repeated identical failures are
 * de-duplicated so polling loops cannot flood the screen.
 */
export function notifyAiIssue(input: unknown, options: NotifyAiIssueOptions = {}): AiIssue {
  const issue = classifyAiIssue(input);
  const now = Date.now();
  const cooldown = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const last = lastShownAt.get(issue.kind) ?? 0;

  if (now - last < cooldown) return issue;
  lastShownAt.set(issue.kind, now);

  toast.error(issue.title, {
    id: `ai-issue-${issue.kind}`,
    description: descriptionFor(issue),
    duration: issue.retryable ? 12_000 : 9_000,
    closeButton: true,
    style: {
      borderColor: "color-mix(in oklch, var(--destructive) 55%, transparent)",
      background: "color-mix(in oklch, var(--destructive) 8%, var(--background))",
    },
    action:
      options.retry && issue.retryable
        ? {
            label: "Retry",
            onClick: () => {
              lastShownAt.delete(issue.kind);
              options.retry?.();
            },
          }
        : undefined,
  });

  return issue;
}
