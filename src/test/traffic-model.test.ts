import { describe, it, expect } from "vitest";
import { computeImpact, BASELINE, DIVERSIONS } from "@/lib/traffic-model";

describe("traffic-model · ORR Agara closure", () => {
  it("baseline peak trip is 20.0 min", () => {
    expect(BASELINE.peakMin).toBe(20.0);
  });

  it("full-closure average trip is 31.8 min", () => {
    const i = computeImpact();
    expect(i.divertedTripMin).toBe(31.8);
  });

  it("queue reaches ~2900 m", () => {
    const i = computeImpact();
    expect(i.queueM).toBeGreaterThan(2700);
    expect(i.queueM).toBeLessThan(3100);
  });

  it("night window saves most person-hours", () => {
    const i = computeImpact();
    expect(i.nightPersonHoursPerHour).toBeLessThan(60);
    expect(i.personHoursSavedByNight).toBeGreaterThan(2000);
  });

  it("diversion shares sum to 1", () => {
    const s = DIVERSIONS.reduce((a, d) => a + d.share, 0);
    expect(s).toBeCloseTo(1, 5);
  });
});
