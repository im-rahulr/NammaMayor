// Browser-side access to the real BBMP layers generated from the KML exports in
// datas/ by scripts/build-bengaluru-data.mjs. Everything here is plain JSON
// served from /data, so it works on any host without a geo backend.

export type RoadSegment = {
  id: number;
  hierarchy: string;
  widthM: number;
  halfWidthM: number;
  type: string;
  lengthM: number;
  /** [lat, lng] pairs, Leaflet order. */
  coords: [number, number][];
  bounds: [number, number, number, number]; // minLat, minLng, maxLat, maxLng
};

export type RoadMeta = {
  source: string;
  generatedAt: string;
  units: { width: string; length: string; coordinates: string };
  segments: number;
  vertices: number;
  totalKm: number;
  bounds: [number, number, number, number];
  hierarchies: string[];
  types: string[];
  hierarchyCounts: Record<string, number>;
  widthHistogram: Record<string, number>;
  widthRange: { min: number; max: number };
};

export type RoadData = { meta: RoadMeta; roads: RoadSegment[] };

export type HealthCentre = {
  id: string;
  name: string;
  zone: string;
  ward: string;
  assembly: string;
  district: string;
  officer: string;
  phone: string;
  lat: number;
  lng: number;
};

export type HealthData = {
  meta: { source: string; generatedAt: string; count: number; zones: string[] };
  centres: HealthCentre[];
};

type RawRoad = [number, number, number, number, number, number[]];

/** Codes used by BBMP's road-width export (RR_TP_HIER). */
export const HIERARCHY_META: Record<string, { label: string; color: string }> = {
  OR: { label: "Outer Ring Road", color: "#f87171" },
  MA: { label: "Major Arterial", color: "#fbbf24" },
  IR: { label: "Inner Ring Road", color: "#22d3ee" },
  MI: { label: "Minor Arterial", color: "#4ade80" },
  CR: { label: "Collector Road", color: "#a78bfa" },
  PU: { label: "Public Road", color: "#f472b6" },
  PR: { label: "Primary Road", color: "#94a3b8" },
};

export const hierarchyMeta = (code: string) =>
  HIERARCHY_META[code] ?? { label: code, color: "#64748b" };

/** Right-of-way buckets, used for the width-coloured view and the legend. */
export const WIDTH_CLASSES = [
  { id: "w12", label: "< 15 m", min: 0, max: 15, color: "#2dd4bf" },
  { id: "w18", label: "15–18 m", min: 15, max: 18, color: "#4ade80" },
  { id: "w24", label: "18–24 m", min: 18, max: 24, color: "#facc15" },
  { id: "w30", label: "24–30 m", min: 24, max: 30, color: "#fb923c" },
  { id: "w45", label: "30–45 m", min: 30, max: 45, color: "#f87171" },
  { id: "w60", label: "45 m +", min: 45, max: Infinity, color: "#e879f9" },
] as const;

export type WidthClass = (typeof WIDTH_CLASSES)[number];

export const widthClass = (widthM: number): WidthClass =>
  WIDTH_CLASSES.find((c) => widthM >= c.min && widthM < c.max) ?? WIDTH_CLASSES[0];

let roadsPromise: Promise<RoadData> | null = null;
let healthPromise: Promise<HealthData> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function loadRoads(): Promise<RoadData> {
  roadsPromise ??= (async () => {
    const { meta } = await getJson<{ meta: RoadMeta }>("/data/roads-index.json");
    const parts = await Promise.all(
      meta.hierarchies.map((code) =>
        getJson<RawRoad[]>(`/data/roads/${encodeURIComponent(code)}.json`),
      ),
    );
    const { hierarchies, types } = meta;
    const roads: RoadSegment[] = parts.flat().map((row, id) => {
      const [h, widthM, halfWidthM, t, lengthM, flat] = row;
      const coords: [number, number][] = [];
      let minLat = 90;
      let maxLat = -90;
      let minLng = 180;
      let maxLng = -180;
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const lng = flat[i]!;
        const lat = flat[i + 1]!;
        coords.push([lat, lng]);
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
      }
      return {
        id,
        hierarchy: hierarchies[h] ?? "NA",
        widthM,
        halfWidthM,
        type: types[t] ?? "NA",
        lengthM,
        coords,
        bounds: [minLat, minLng, maxLat, maxLng],
      };
    });
    return { meta, roads };
  })();
  return roadsPromise;
}

export function loadHealthCentres(): Promise<HealthData> {
  healthPromise ??= getJson<HealthData>("/data/health-centres.json");
  return healthPromise;
}

const METERS_PER_DEG_LAT = 110_540;

function pointToSegmentMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const kx = Math.cos((pLat * Math.PI) / 180) * 111_320;
  const ky = METERS_PER_DEG_LAT;
  const ax = (aLng - pLng) * kx;
  const ay = (aLat - pLat) * ky;
  const bx = (bLng - pLng) * kx;
  const by = (bLat - pLat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export type RoadHit = { road: RoadSegment; distanceM: number };

/**
 * Nearest mapped road to a clicked point. Uses each segment's bounding box to
 * skip the long tail, so a click only tests a few hundred candidates.
 */
export function nearestRoad(
  roads: RoadSegment[],
  lat: number,
  lng: number,
  maxMeters = 120,
): RoadHit | null {
  const dLat = maxMeters / METERS_PER_DEG_LAT;
  const dLng = maxMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  let best: RoadHit | null = null;
  for (const road of roads) {
    const [minLat, minLng, maxLat, maxLng] = road.bounds;
    if (lat < minLat - dLat || lat > maxLat + dLat || lng < minLng - dLng || lng > maxLng + dLng)
      continue;
    const c = road.coords;
    for (let i = 1; i < c.length; i++) {
      const d = pointToSegmentMeters(lat, lng, c[i - 1]![0], c[i - 1]![1], c[i]![0], c[i]![1]);
      if (!best || d < best.distanceM) best = { road, distanceM: d };
    }
  }
  return best && best.distanceM <= maxMeters ? best : null;
}

/** Compact human formatting used by the map legend + info cards. */
export const formatKm = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
