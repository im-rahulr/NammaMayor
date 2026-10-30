// Baked fallback for the ORR Agara closure scenario (live OSRM may be rate-limited).
// Coordinates are WGS84; durations are the values OSRM returned for these waypoints.
import type { Diversion } from "@/lib/traffic-model";

export const CLOSURE = {
  road: "Outer Ring Road (ORR) · Eastbound",
  from: "Silk Board Junction",
  to: "Agara / HSR 27th Main",
  cause: "BBMP utility work — water main replacement",
  lanesClosed: 3,
  lanesTotal: 3,
  segment: [
    [12.9177, 77.6238],
    [12.92, 77.629],
    [12.922, 77.636],
    [12.9235, 77.6431],
  ] as [number, number][],
};

export const ROUTE_WAYPOINTS: Record<string, [number, number][]> = {
  baseline: [
    [12.9177, 77.6238],
    [12.926, 77.6762],
  ],
  A: [
    [12.9177, 77.6238],
    [12.9142, 77.6529],
    [12.926, 77.6762],
  ],
  B: [
    [12.9177, 77.6238],
    [12.9105, 77.673],
    [12.926, 77.6762],
  ],
  C: [
    [12.9177, 77.6238],
    [12.9352, 77.6245],
    [12.926, 77.6762],
  ],
  D: [
    [12.9177, 77.6238],
    [12.9166, 77.6101],
    [12.926, 77.6762],
  ],
};

export const OSRM_DURATIONS_MIN: Record<string, number> = {
  baseline: 8.3,
  A: 12.1,
  B: 17.7,
  C: 16.1,
  D: 24.9,
};

export const OSRM_KM: Record<string, number> = {
  baseline: 6.29,
  A: 8.07,
  B: 11.69,
  C: 11.62,
  D: 17.24,
};

// Re-assert diversion geometry matches the model.
export const DIVERSION_LABELS: Record<string, string> = {
  A: "via HSR 27th Main",
  B: "via Sarjapur Rd",
  C: "via Koramangala",
  D: "via BTM / Hosur Rd",
};
