import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUESTION,
  DEFAULT_SYSTEM_PROMPT,
  askQuestion,
  compileSupervisorReport,
} from "@/lib/nvidia";

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

const collision = {
  type: "accident",
  typeName: "Road Accident",
  locationName: "Silk Board Junction",
  lat: 12.9115,
  lng: 77.6861,
  severity: "CRITICAL",
  description: "Two-lane collision on the eastbound approach.",
};

describe("supervisor incident report compile", () => {
  it("lifts authorised actions from the doing agents and risks from the modellers", () => {
    const report = compileSupervisorReport(collision, [
      {
        from: "prediction",
        to: "FORECAST",
        text: "CCTV node #BLR-321 confirms debris across 2 lanes.",
      },
      { from: "FORECAST", to: "MOBILITY", text: "Queue spillback reaches 1.4 km in 18 minutes." },
      { from: "MOBILITY", to: "SAFETY", text: "Diverting BMTC 335 via Residency Road (+8 min)." },
      {
        from: "SAFETY",
        to: "COMMS",
        text: "Dispatched 2 ambulances and 1 rescue tender; ETA 4 min.",
      },
      {
        from: "COMMS",
        to: "prediction",
        text: "Collision advisory broadcast to 12,400 commuters.",
      },
    ]);

    expect(report.headline).toContain("Silk Board Junction");
    expect(report.situation).toContain("Two-lane collision");
    expect(report.authorisedActions).toEqual([
      "Diverting BMTC 335 via Residency Road (+8 min).",
      "Dispatched 2 ambulances and 1 rescue tender; ETA 4 min.",
      "Collision advisory broadcast to 12,400 commuters.",
    ]);
    expect(report.unresolvedRisks[0]).toBe("Queue spillback reaches 1.4 km in 18 minutes.");
    expect(report.unresolvedRisks).toHaveLength(3);
    expect(report.verdict).toContain("authorised");
  });

  it("keeps the newest line when an agent speaks twice", () => {
    const report = compileSupervisorReport(collision, [
      { from: "SAFETY", to: "COMMS", text: "Staging 1 ambulance at the perimeter." },
      { from: "SAFETY", to: "COMMS", text: "Extrication team on scene, 4 casualties recovered." },
    ]);

    expect(report.authorisedActions).toEqual([
      "Extrication team on scene, 4 casualties recovered.",
    ]);
  });

  it("still reports when the agent thread is empty", () => {
    const report = compileSupervisorReport({ ...collision, description: "" }, []);

    expect(report.situation).toContain("5-agent cycle closed");
    expect(report.authorisedActions[0]).toContain("Silk Board Junction");
    expect(report.unresolvedRisks).toHaveLength(1);
  });
});
