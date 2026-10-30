import { describe, expect, it } from "vitest";
import { DEFAULT_QUESTION, DEFAULT_SYSTEM_PROMPT, askQuestion } from "@/lib/nvidia";

describe("nvidia text question assistant", () => {
  it("defines sensible default question and system prompt", () => {
    expect(DEFAULT_QUESTION).toContain("Silk Board");
    expect(DEFAULT_SYSTEM_PROMPT).toContain("Bengaluru City Command Center");
  });

  it("fails validator when question is empty", () => {
    // TanStack server fn validator can be tested directly
    expect(() =>
      (
        askQuestion as unknown as {
          _validator: (args: { data: { question: string } }) => void;
        }
      )._validator({ data: { question: "" } }),
    ).toThrow();
  });
});
