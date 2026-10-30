import { describe, expect, it } from "vitest";
import {
  formatKm,
  hierarchyMeta,
  nearestRoad,
  widthClass,
  type RoadSegment,
} from "@/lib/city-data";

const road = (id: number, coords: [number, number][]): RoadSegment => {
  const lats = coords.map((c) => c[0]);
  const lngs = coords.map((c) => c[1]);
  return {
    id,
    hierarchy: "MA",
    widthM: 24,
    halfWidthM: 12,
    type: "W",
    lengthM: 250,
    coords,
    bounds: [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)],
  };
};

describe("widthClass", () => {
  it("maps BBMP right-of-way widths to the legend buckets", () => {
    expect(widthClass(12).id).toBe("w12");
    expect(widthClass(14.9).id).toBe("w12");
    expect(widthClass(15).id).toBe("w18");
    expect(widthClass(24).id).toBe("w30");
    expect(widthClass(45).id).toBe("w60");
    expect(widthClass(100).id).toBe("w60");
  });
});

describe("nearestRoad", () => {
  const roads = [
    road(0, [
      [12.9177, 77.6238],
      [12.92, 77.63],
    ]),
    road(1, [
      [12.95, 77.7],
      [12.951, 77.701],
    ]),
  ];

  it("finds the closest segment and reports the offset", () => {
    const hit = nearestRoad(roads, 12.9178, 77.6239);
    expect(hit?.road.id).toBe(0);
    expect(hit?.distanceM).toBeGreaterThan(0);
    expect(hit?.distanceM).toBeLessThan(20);
  });

  it("returns null when every road is beyond the search radius", () => {
    expect(nearestRoad(roads, 12.8, 77.5)).toBeNull();
  });

  it("honours a wider search radius", () => {
    const hit = nearestRoad(roads, 12.9205, 77.6255, 900);
    expect(hit?.road.id).toBe(0);
    expect(hit!.distanceM).toBeGreaterThan(100);
    expect(hit!.distanceM).toBeLessThan(900);
  });
});

describe("labels", () => {
  it("knows the BBMP road classes and falls back for unknown codes", () => {
    expect(hierarchyMeta("OR").label).toBe("Outer Ring Road");
    expect(hierarchyMeta("ZZ").label).toBe("ZZ");
  });

  it("formats metres and kilometres", () => {
    expect(formatKm(240)).toBe("240 m");
    expect(formatKm(2241)).toBe("2.2 km");
  });
});
