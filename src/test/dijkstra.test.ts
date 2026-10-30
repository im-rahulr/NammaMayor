import { describe, it, expect } from "vitest";
import { shortestPath, kAlternatives } from "@/lib/dijkstra";

describe("dijkstra", () => {
  it("finds Silk Board -> Bellandur", () => {
    const p = shortestPath("SILK", "BELL");
    expect(p).not.toBeNull();
    expect(p!.minutes).toBeLessThan(12);
  });
  it("avoids blocked edge", () => {
    const base = shortestPath("SILK", "BELL")!;
    const blocked = new Set([base.edgeIds[0]!]);
    const alt = shortestPath("SILK", "BELL", blocked);
    expect(alt).not.toBeNull();
    expect(alt!.edgeIds).not.toContain(base.edgeIds[0]);
    expect(alt!.minutes).toBeGreaterThanOrEqual(base.minutes);
  });
  it("returns k alternatives", () => {
    const alts = kAlternatives("SILK", "BELL", 3);
    expect(alts.length).toBeGreaterThanOrEqual(2);
  });
});
