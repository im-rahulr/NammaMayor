// Builds the compact, browser-ready layers used by /command from the raw
// Bengaluru KML exports kept in datas/.
//
//   node scripts/build-bengaluru-data.mjs
//
// Outputs:
//   public/data/bengaluru-roads.json   road-width network (23k segments)
//   public/data/health-centres.json    BBMP UPHC health centres (139 points)
//
// KML attributes are preserved as-is, only geometry is rounded to ~1 m
// (5 decimal degrees) and consecutive duplicate vertices are dropped.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "datas");
const OUT_DIR = path.join(ROOT, "public", "data");

const ROAD_KML = path.join(DATA_DIR, "Bengaluru Road Width Map.kml");
const HEALTH_KML = path.join(DATA_DIR, "health-data.kml");

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

function placemarks(kml) {
  return kml
    .split("<Placemark>")
    .slice(1)
    .map((chunk) => chunk.split("</Placemark>")[0]);
}

function simpleData(block) {
  const out = {};
  for (const m of block.matchAll(/<SimpleData\s+name="([^"]+)"\s*>([\s\S]*?)<\/SimpleData>/g)) {
    out[m[1]] = m[2].replace(/\s+/g, " ").trim();
  }
  return out;
}

function lineStrings(block) {
  const lines = [];
  for (const m of block.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)) {
    const points = [];
    for (const raw of m[1].trim().split(/\s+/)) {
      if (!raw) continue;
      const [lng, lat] = raw.split(",");
      if (lng === undefined || lat === undefined) continue;
      const p = [round5(Number(lng)), round5(Number(lat))];
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const prev = points[points.length - 1];
      if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
      points.push(p);
    }
    if (points.length >= 2) lines.push(points);
  }
  return lines;
}

const numberOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// Keep buckets in sync with WIDTH_CLASSES in src/lib/city-data.ts.
const widthClassOf = (widthM) => {
  if (widthM >= 45) return "w60";
  if (widthM >= 30) return "w45";
  if (widthM >= 24) return "w30";
  if (widthM >= 18) return "w24";
  if (widthM >= 15) return "w18";
  return "w12";
};

async function buildRoads() {
  const kml = await readFile(ROAD_KML, "utf8");
  const blocks = placemarks(kml);
  const hierIndex = new Map();
  const typeIndex = new Map();
  const roads = [];
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const hierCounts = {};
  const widthHistogram = {};
  let totalMeters = 0;
  let points = 0;

  for (const block of blocks) {
    const attrs = simpleData(block);
    const hierarchy = attrs.RR_TP_HIER || "NA";
    const type = attrs.RR_TP_TYPE || "NA";
    const widthM = numberOr(attrs.RR_WIDTH_P, 0);
    const halfWidthM = numberOr(attrs.RR_width_B, 0);

    if (!hierIndex.has(hierarchy)) hierIndex.set(hierarchy, hierIndex.size);
    if (!typeIndex.has(type)) typeIndex.set(type, typeIndex.size);

    for (const coords of lineStrings(block)) {
      let lengthM = 0;
      for (let i = 1; i < coords.length; i++) {
        lengthM += haversine(coords[i - 1], coords[i]);
        const [lng, lat] = coords[i];
        if (lng < bounds[0]) bounds[0] = lng;
        if (lat < bounds[1]) bounds[1] = lat;
        if (lng > bounds[2]) bounds[2] = lng;
        if (lat > bounds[3]) bounds[3] = lat;
      }
      const [lng0, lat0] = coords[0];
      if (lng0 < bounds[0]) bounds[0] = lng0;
      if (lat0 < bounds[1]) bounds[1] = lat0;
      if (lng0 > bounds[2]) bounds[2] = lng0;
      if (lat0 > bounds[3]) bounds[3] = lat0;

      totalMeters += lengthM;
      points += coords.length;
      hierCounts[hierarchy] = (hierCounts[hierarchy] ?? 0) + 1;
      const className = widthClassOf(widthM);
      widthHistogram[className] = (widthHistogram[className] ?? 0) + 1;

      roads.push([
        hierIndex.get(hierarchy),
        widthM,
        halfWidthM,
        typeIndex.get(type),
        Math.round(lengthM),
        coords.flat(),
      ]);
    }
  }

  const hier = [...hierIndex.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  const types = [...typeIndex.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);

  const payload = {
    meta: {
      source: "BBMP Bengaluru Road Width Map (KML)",
      generatedAt: new Date().toISOString(),
      units: { width: "m", length: "m", coordinates: "lng,lat" },
      segments: roads.length,
      vertices: points,
      totalKm: Math.round(totalMeters / 100) / 10,
      bounds,
      hierarchies: hier,
      types,
      hierarchyCounts: hierCounts,
      widthHistogram,
      widthRange: {
        min: Math.min(...roads.map((r) => r[1])),
        max: Math.max(...roads.map((r) => r[1])),
      },
    },
  };

  // Split per road class. A single 2.5 MB JSON under public/ crashes the
  // nitro/Cloudflare production build on Windows, and chunking also means the
  // browser only pays for the classes it draws.
  const roadsDir = path.join(OUT_DIR, "roads");
  await mkdir(roadsDir, { recursive: true });
  const byHierarchy = new Map(hier.map((code) => [code, []]));
  for (const road of roads) byHierarchy.get(hier[road[0]])?.push(road);
  const files = [];
  for (const [code, list] of byHierarchy) {
    const file = path.join(roadsDir, `${code}.json`);
    await writeFile(file, JSON.stringify(list));
    files.push(file);
  }
  const indexFile = path.join(OUT_DIR, "roads-index.json");
  await writeFile(indexFile, JSON.stringify(payload));
  return { files: [indexFile, ...files], meta: payload.meta };
}

// The KML mixes ALL-CAPS and title-case zone names (EAST vs East); normalise
// so zone grouping, counts and colours stay consistent.
const ZONE_NAMES = {
  EAST: "East",
  WEST: "West",
  SOUTH: "South",
  NORTH: "North",
  "RR NAGAR": "RR Nagar",
};
const normalizeZone = (zone) => {
  const t = (zone || "").trim();
  return ZONE_NAMES[t.toUpperCase()] ?? (t || "Unassigned");
};

async function buildHealth() {
  const kml = await readFile(HEALTH_KML, "utf8");
  const centres = [];
  for (const block of placemarks(kml)) {
    const a = simpleData(block);
    const point = /<Point>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(block);
    let lat = numberOr(a.Lattitude, NaN);
    let lng = numberOr(a.Longitude, NaN);
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && point) {
      const [plng, plat] = point[1].trim().split(",");
      lng = Number(plng);
      lat = Number(plat);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    centres.push({
      id: `UPHC-${a.FID ?? centres.length}`,
      name: a.UPHC || `UPHC ${centres.length + 1}`,
      zone: normalizeZone(a.Zone),
      ward: a.ward || "",
      assembly: a.ac || "",
      district: a.ls || "",
      officer: a.NODAL_OFFI || "",
      phone: a.Contact_No || "",
      lat: round5(lat),
      lng: round5(lng),
    });
  }

  centres.sort((a, b) => a.zone.localeCompare(b.zone) || a.name.localeCompare(b.name));
  const payload = {
    meta: {
      source: "BBMP Urban Primary Health Centres (UPHC), Bengaluru (KML)",
      generatedAt: new Date().toISOString(),
      count: centres.length,
      zones: [...new Set(centres.map((c) => c.zone))].sort(),
    },
    centres,
  };

  const file = path.join(OUT_DIR, "health-centres.json");
  await writeFile(file, JSON.stringify(payload));
  return { file, meta: payload.meta };
}

await mkdir(OUT_DIR, { recursive: true });
const roads = await buildRoads();
const health = await buildHealth();

async function report({ file }) {
  const { stat } = await import("node:fs/promises");
  const size = (await stat(file)).size;
  return `${path.relative(ROOT, file)} — ${Math.round(size / 1024)} KB`;
}

async function reportAll(files) {
  const { stat } = await import("node:fs/promises");
  let total = 0;
  for (const file of files) total += (await stat(file)).size;
  return (
    `${files.length} files — ${Math.round(total / 1024)} KB total\n  ` +
    (await Promise.all(files.map((file) => report({ file })))).join("\n  ")
  );
}

console.log(
  `roads: ${roads.meta.segments} segments, ${roads.meta.totalKm} km, ${roads.meta.vertices} vertices`,
);
console.log(await reportAll(roads.files));
console.log(`health: ${health.meta.count} centres across ${health.meta.zones.length} zones`);
console.log(await report(health));
