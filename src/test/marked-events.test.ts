import { describe, expect, it } from "vitest";
import { EVENT_TYPES, PRESET_EVENTS } from "@/routes/command";
import { AGENT_TURN_ORDER, agentChat } from "@/lib/nvidia";

describe("Map Event Marking & 5 AI Collaboration", () => {
  it("defines all major emergency event categories", () => {
    expect(EVENT_TYPES.length).toBeGreaterThanOrEqual(6);
    const types = EVENT_TYPES.map((e) => e.type);
    expect(types).toContain("flood");
    expect(types).toContain("gas");
    expect(types).toContain("accident");
    expect(types).toContain("roadblock");
    expect(types).toContain("fire");
    expect(types).toContain("medical");
  });

  it("has valid preset events with location coordinates", () => {
    expect(PRESET_EVENTS.length).toBeGreaterThanOrEqual(4);
    PRESET_EVENTS.forEach((preset) => {
      expect(preset.lat).toBeGreaterThan(12.5);
      expect(preset.lat).toBeLessThan(13.5);
      expect(preset.lng).toBeGreaterThan(77.4);
      expect(preset.lng).toBeLessThan(77.8);
      expect(preset.title).toBeTruthy();
    });
  });

  it("defines the 5 AI agents in deterministic turn order", () => {
    expect(AGENT_TURN_ORDER).toHaveLength(5);
    const fromAgents = AGENT_TURN_ORDER.map(([from]) => from);
    expect(fromAgents).toContain("prediction");
    expect(fromAgents).toContain("FORECAST");
    expect(fromAgents).toContain("MOBILITY");
    expect(fromAgents).toContain("SAFETY");
    expect(fromAgents).toContain("COMMS");
  });

  it("agentChat is an exported TanStack Start server function", () => {
    expect(typeof agentChat).toBe("function");
  });
});
