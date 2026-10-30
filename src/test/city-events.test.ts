import { describe, expect, it } from "vitest";
import {
  CITY_EVENTS,
  estimateEventImpact,
  eventRiskScore,
  rankEvents,
  riskLevelFor,
} from "@/lib/city-events";

describe("city-events · risk scoring", () => {
  it("keeps every score inside 0-100", () => {
    for (const event of CITY_EVENTS) {
      const { score } = eventRiskScore(event);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("maps scores onto the documented bands", () => {
    expect(riskLevelFor(10)).toBe("LOW");
    expect(riskLevelFor(50)).toBe("MODERATE");
    expect(riskLevelFor(70)).toBe("HIGH");
    expect(riskLevelFor(90)).toBe("SEVERE");
  });

  it("ranks events in descending risk order", () => {
    const ranked = rankEvents();
    expect(ranked).toHaveLength(CITY_EVENTS.length);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it("puts the sold-out CBD cricket fixture above the neighbourhood book fair", () => {
    const cricket = CITY_EVENTS.find((e) => e.id === "rcb-mi-2026")!;
    const fair = CITY_EVENTS.find((e) => e.id === "jayanagar-bookfair-2026")!;
    expect(eventRiskScore(cricket).score).toBeGreaterThan(eventRiskScore(fair).score);
  });
});

describe("city-events · deterministic impact estimate", () => {
  const event = CITY_EVENTS.find((e) => e.id === "arijit-palace-2026")!;
  const impact = estimateEventImpact(event);

  it("keeps inflow phases summing to 100%", () => {
    const total = impact.crowd.inflow.reduce((sum, phase) => sum + phase.pct, 0);
    expect(total).toBe(100);
  });

  it("splits the expected crowd across the arrival phases", () => {
    const people = impact.crowd.inflow.reduce((sum, phase) => sum + phase.people, 0);
    expect(people).toBe(event.expectedAttendance);
  });

  it("derives corridor delays and parking demand from the event", () => {
    expect(impact.traffic.corridors.length).toBeGreaterThan(0);
    expect(impact.traffic.corridors[0]!.corridor).toBe(event.nearbyArterials[0]);
    expect(impact.traffic.parkingDemand).toBeGreaterThan(0);
    expect(impact.traffic.addedPcuPerHour).toBeGreaterThan(0);
  });

  it("reports the same risk level as the scorer", () => {
    const { score, level } = eventRiskScore(event);
    expect(impact.risk.score).toBe(score);
    expect(impact.risk.level).toBe(level);
    expect(impact.source).toBe("model");
  });

  it("flags rolling closures only for marathons", () => {
    const marathon = CITY_EVENTS.find((e) => e.category === "marathon")!;
    expect(estimateEventImpact(marathon).traffic.closures.length).toBeGreaterThan(0);
    expect(impact.traffic.closures).toHaveLength(0);
  });
});
