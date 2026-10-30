// Server-only: fetch real OSM streets around a clicked point, build a graph,
// snap the click to the nearest segment, block it and run Dijkstra.

export type ONode = { id: string; lat: number; lng: number };
export type OEdge = { id: string; from: string; to: string; meters: number };
export type OPath = {
  nodeIds: string[];
  coords: [number, number][];
  meters: number;
  minutes: number;
};

const HIGHWAYS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
]);

const SPEED_KMH: Record<string, number> = {
  motorway: 60,
  trunk: 50,
  primary: 40,
  secondary: 35,
  tertiary: 30,
  unclassified: 25,
  residential: 20,
  living_street: 15,
  service: 15,
  road: 20,
};

const R = 6371000;
function haversine(a: ONode, b: ONode): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distToSegment(p: { lat: number; lng: number }, a: ONode, b: ONode): number {
  // equirectangular projection around the point
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  const ax = (a.lng - p.lng) * kx,
    ay = (a.lat - p.lat) * ky;
  const bx = (b.lng - p.lng) * kx,
    by = (b.lat - p.lat) * ky;
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx,
    py = ay + t * dy;
  return Math.hypot(px, py);
}

type Way = { id: string; refs: string[]; highway: string; name?: string | undefined };

const cache = new Map<string, { at: number; data: { nodes: Map<string, ONode>; ways: Way[] } }>();
const TTL = 10 * 60_000;

export async function fetchOsmAround(lat: number, lng: number, radiusM = 400) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const dLat = radiusM / 110540;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map((v) => v.toFixed(6)).join(",");
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`;
  let xml = "";
  for (let attempt = 0; attempt < 2 && !xml; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "NammaMayorOS/2.0 (+city operations dashboard)" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`OSM ${res.status}`);
      xml = await res.text();
    } catch (e) {
      if (attempt === 1) throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  const nodes = new Map<string, ONode>();
  for (const m of xml.matchAll(/<node\b([^>]*?)\/?>/g)) {
    const attrs = m[1]!;
    const id = /id="(-?\d+)"/.exec(attrs)?.[1];
    const lat = /lat="([-\d.]+)"/.exec(attrs)?.[1];
    const lon = /lon="([-\d.]+)"/.exec(attrs)?.[1];
    if (id && lat && lon) nodes.set(id, { id, lat: +lat, lng: +lon });
  }

  const ways: Way[] = [];
  for (const m of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const body = m[2]!;
    const wayId = /id="(-?\d+)"/.exec(m[1]!)?.[1];
    if (!wayId) continue;
    const refs = [...body.matchAll(/<nd\s+ref="(-?\d+)"/g)].map((x) => x[1]!);
    const highway = /<tag\s+k="highway"\s+v="([^"]+)"/.exec(body)?.[1];
    const name = /<tag\s+k="name"\s+v="([^"]+)"/.exec(body)?.[1];
    if (highway && HIGHWAYS.has(highway) && refs.length >= 2)
      ways.push({ id: wayId, refs, highway, name });
  }
  if (!nodes.size || !ways.length) throw new Error("No mapped roads near that point");
  const data = { nodes, ways };
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function detourAtPoint(
  lat: number,
  lng: number,
): Promise<{
  blockedWay: string;
  blockedRoad: string;
  point: { lat: number; lng: number };
  detour: OPath | null;
  alternatives: OPath[];
}> {
  const { nodes, ways } = await fetchOsmAround(lat, lng);

  // nearest segment across all ways
  let best: { way: Way; i: number; d: number } | null = null;
  for (const way of ways) {
    for (let i = 0; i < way.refs.length - 1; i++) {
      const a = nodes.get(way.refs[i]!),
        b = nodes.get(way.refs[i + 1]!);
      if (!a || !b) continue;
      const d = distToSegment({ lat, lng }, a, b);
      if (!best || d < best.d) best = { way, i, d };
    }
  }
  if (!best) throw new Error("Could not match a road to that point");

  const segStart = nodes.get(best.way.refs[best.i]!);
  const segEnd = nodes.get(best.way.refs[best.i + 1]!);
  if (!segStart || !segEnd) throw new Error("Road segment missing geometry");

  const blockedId = `${best.way.id}:${best.i}`;
  // Block the whole named road; if that disconnects the segment, fall back to one segment.
  const blocked = new Set<string>();
  for (let i = 0; i < best.way.refs.length - 1; i++) {
    blocked.add(`${best.way.id}:${i}`);
    blocked.add(`${best.way.id}:${i}:r`);
  }

  // adjacency
  const adj = new Map<string, { to: string; id: string; meters: number; speed: number }[]>();
  const add = (from: string, to: string, id: string, meters: number, speed: number) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, id, meters, speed });
  };
  for (const way of ways) {
    const speed = SPEED_KMH[way.highway] ?? 20;
    for (let i = 0; i < way.refs.length - 1; i++) {
      const a = nodes.get(way.refs[i]!),
        b = nodes.get(way.refs[i + 1]!);
      if (!a || !b) continue;
      const m = haversine(a, b);
      add(a.id, b.id, `${way.id}:${i}`, m, speed);
      add(b.id, a.id, `${way.id}:${i}:r`, m, speed);
    }
  }

  const runDijkstra = (start: string, end: string): OPath | null => {
    const dist = new Map<string, number>([[start, 0]]);
    const prev = new Map<string, { node: string; id: string }>();
    const done = new Set<string>();
    const pq: [number, string][] = [[0, start]];
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [d, u] = pq.shift()!;
      if (done.has(u)) continue;
      done.add(u);
      if (u === end) break;
      for (const e of adj.get(u) ?? []) {
        if (blocked.has(e.id)) continue;
        const nd = d + e.meters;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, { node: u, id: e.id });
          pq.push([nd, e.to]);
        }
      }
    }
    if (!dist.has(end)) return null;
    const nodeIds: string[] = [];
    const edgeIds: string[] = [];
    let cur = end;
    while (cur !== start) {
      nodeIds.unshift(cur);
      const p = prev.get(cur)!;
      edgeIds.unshift(p.id);
      cur = p.node;
    }
    nodeIds.unshift(start);
    const meters = dist.get(end)!;
    const minutes = edgeIds.reduce((s, id) => {
      const e = [...adj.values()].flat().find((x) => x.id === id);
      return s + (e ? (e.meters / 1000 / e.speed) * 60 : 0);
    }, 0);
    const coords = nodeIds.map((id) => {
      const n = nodes.get(id)!;
      return [n.lat, n.lng] as [number, number];
    });
    return { nodeIds, coords, meters: Math.round(meters), minutes: +minutes.toFixed(1) };
  };

  let detour = runDijkstra(segStart.id, segEnd.id);
  if (!detour) {
    // whole-way block disconnected the points: block only the clicked segment
    blocked.clear();
    blocked.add(blockedId);
    blocked.add(`${blockedId}:r`);
    detour = runDijkstra(segStart.id, segEnd.id);
  }

  return {
    blockedWay: best.way.id,
    blockedRoad: best.way.name ?? best.way.highway,
    point: { lat: segStart.lat, lng: segStart.lng },
    detour,
    alternatives: detour ? [detour] : [],
  };
}
