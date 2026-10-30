import { describe, expect, it } from "vitest";

import { classifyAiIssue } from "@/lib/ai-errors";

describe("AI issue classification", () => {
  it("flags HTTP 429 rate limits and reads Retry-After", () => {
    const issue = classifyAiIssue(
      new Error("NVIDIA API 429 (retry after 12s): rate limit exceeded"),
    );
    expect(issue.kind).toBe("rate-limit");
    expect(issue.title).toBe("AI rate limit reached");
    expect(issue.retryable).toBe(true);
    expect(issue.retryAfterSec).toBe(12);
  });

  it("flags an exhausted quota", () => {
    const issue = classifyAiIssue(new Error("NVIDIA API 402: insufficient quota for this key"));
    expect(issue.kind).toBe("quota");
  });

  it("flags rejected credentials", () => {
    const issue = classifyAiIssue(new Error("NVIDIA API 401: Unauthorized"));
    expect(issue.kind).toBe("auth");
    expect(issue.retryable).toBe(false);
  });

  it("flags a missing API key", () => {
    const issue = classifyAiIssue(
      new Error("NVIDIA_API_KEY is not set. Add it to .env (see .env.example)."),
    );
    expect(issue.kind).toBe("missing-key");
    expect(issue.retryable).toBe(false);
  });

  it("flags timeouts", () => {
    const issue = classifyAiIssue(new Error("NVIDIA API timed out after 90 seconds."));
    expect(issue.kind).toBe("timeout");
    expect(issue.retryable).toBe(true);
  });

  it("flags upstream server errors", () => {
    const issue = classifyAiIssue(new Error("NVIDIA API 503: Service Unavailable"));
    expect(issue.kind).toBe("server");
  });

  it("flags network failures", () => {
    const issue = classifyAiIssue(new Error("fetch failed"));
    expect(issue.kind).toBe("network");
  });

  it("flags unreadable model responses", () => {
    const issue = classifyAiIssue(new Error("NVIDIA API returned a non-JSON response."));
    expect(issue.kind).toBe("bad-response");
  });

  it("never throws on unknown input", () => {
    const issue = classifyAiIssue(undefined);
    expect(issue.kind).toBe("unknown");
    expect(issue.title).toBe("AI request failed");
  });
});
