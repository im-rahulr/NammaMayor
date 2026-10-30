import { ALL_EDGES, NODES, type Edge, type Node, getNode, getEdgeCoords } from "@/lib/road-graph";

export type PathResult = { nodeIds: string[]; edgeIds: string[]; minutes: number; km: number };

export function findNearestNode(lat: number, lng: number): Node {
  let best = NODES[0]!;
  let bestDist = Infinity;
  for (const n of NODES) {
    const d = Math.hypot(n.lat - lat, n.lng - lng);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

export type DijkstraRouteResult = {
  nodeIds: string[];
  nodeNames: string[];
  edgeIds: string[];
  coords: [number, number][];
  distanceKm: number;
  durationMin: number;
  computeTimeMs: number;
  algorithm: "Dijkstra";
  startNode: Node;
  endNode: Node;
};

export function computeDijkstraPath(
  startPoint: { lat: number; lng: number; name?: string },
  endPoint: { lat: number; lng: number; name?: string },
  blockedEdgeIds: Set<string> = new Set(),
): DijkstraRouteResult | null {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const startNode = findNearestNode(startPoint.lat, startPoint.lng);
  const endNode = findNearestNode(endPoint.lat, endPoint.lng);

  if (startNode.id === endNode.id) {
    const dKm = +(
      Math.hypot(endPoint.lat - startPoint.lat, endPoint.lng - startPoint.lng) * 111
    ).toFixed(2);
    const computeTimeMs = +(
      (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0
    ).toFixed(2);
    return {
      nodeIds: [startNode.id],
      nodeNames: [startNode.name],
      edgeIds: [],
      coords: [
        [startPoint.lat, startPoint.lng],
        [endPoint.lat, endPoint.lng],
      ],
      distanceKm: dKm || 0.5,
      durationMin: +(dKm * 2.5).toFixed(1) || 1.5,
      computeTimeMs: Math.max(0.1, computeTimeMs),
      algorithm: "Dijkstra",
      startNode,
      endNode,
    };
  }

  const result = shortestPath(startNode.id, endNode.id, blockedEdgeIds);
  const computeTimeMs = +(
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0
  ).toFixed(2);
  if (!result) return null;

  const coords: [number, number][] = [];
  coords.push([startPoint.lat, startPoint.lng]);
  if (Math.hypot(startPoint.lat - startNode.lat, startPoint.lng - startNode.lng) > 0.002) {
    coords.push([startNode.lat, startNode.lng]);
  }

  for (const eid of result.edgeIds) {
    const edgeCoords = getEdgeCoords(eid);
    for (const pt of edgeCoords) {
      const last = coords[coords.length - 1];
      if (!last || Math.abs(last[0] - pt[0]) > 0.0001 || Math.abs(last[1] - pt[1]) > 0.0001) {
        coords.push(pt);
      }
    }
  }

  if (Math.hypot(endPoint.lat - endNode.lat, endPoint.lng - endNode.lng) > 0.002) {
    coords.push([endPoint.lat, endPoint.lng]);
  }

  const nodeNames = result.nodeIds.map((id) => getNode(id)?.name ?? id);

  return {
    nodeIds: result.nodeIds,
    nodeNames,
    edgeIds: result.edgeIds,
    coords,
    distanceKm: result.km,
    durationMin: result.minutes,
    computeTimeMs: Math.max(0.1, computeTimeMs),
    algorithm: "Dijkstra",
    startNode,
    endNode,
  };
}

export function shortestPath(
  start: string,
  end: string,
  blocked: Set<string> = new Set(),
  edges: Edge[] = ALL_EDGES,
): PathResult | null {
  const adj = new Map<string, Edge[]>();
  for (const e of edges) {
    const base = e.id.endsWith("r") ? e.id.slice(0, -1) : e.id;
    if (blocked.has(e.id) || blocked.has(base)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  }
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edge: string }>();
  const visited = new Set<string>();
  dist.set(start, 0);
  // simple priority queue via array (graph is tiny)
  const pq: { node: string; d: number }[] = [{ node: start, d: 0 }];
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const { node } = pq.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (node === end) break;
    for (const e of adj.get(node) ?? []) {
      if (visited.has(e.to)) continue;
      const nd = (dist.get(node) ?? Infinity) + e.minutes;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { node, edge: e.id });
        pq.push({ node: e.to, d: nd });
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
    edgeIds.unshift(p.edge);
    cur = p.node;
  }
  nodeIds.unshift(start);
  const km = edgeIds.reduce((s, id) => s + (edges.find((e) => e.id === id)?.km ?? 0), 0);
  return { nodeIds, edgeIds, minutes: dist.get(end)!, km: +km.toFixed(2) };
}

// Exhaustively enumerate every simple path between two junctions (graph is tiny).
// Returns all candidate routes sorted by travel minutes — the first entry is the
// shortest one. Coords are stitched from per-edge geometries.
export type EnumeratedRoute = PathResult & {
  nodeNames: string[];
  coords: [number, number][];
};

export function enumerateAllRoutes(start: string, end: string, maxRoutes = 60): EnumeratedRoute[] {
  if (start === end) return [];
  const adj = new Map<string, Edge[]>();
  for (const e of ALL_EDGES) {
    const list = adj.get(e.from);
    if (list) list.push(e);
    else adj.set(e.from, [e]);
  }

  type Raw = { nodes: string[]; edges: string[]; minutes: number; km: number };
  const raw: Raw[] = [];
  const visited = new Set<string>([start]);

  const walk = (node: string, nodes: string[], edges: string[], minutes: number, km: number) => {
    if (raw.length >= maxRoutes) return;
    if (node === end) {
      raw.push({ nodes: [...nodes], edges: [...edges], minutes, km });
      return;
    }
    for (const e of adj.get(node) ?? []) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      walk(e.to, [...nodes, e.to], [...edges, e.id], minutes + e.minutes, km + e.km);
      visited.delete(e.to);
    }
  };
  walk(start, [start], [], 0, 0);

  return raw
    .sort((a, b) => a.minutes - b.minutes)
    .map((r) => {
      const coords: [number, number][] = [];
      for (const eid of r.edges) {
        for (const pt of getEdgeCoords(eid)) {
          const last = coords[coords.length - 1];
          if (!last || Math.abs(last[0] - pt[0]) > 1e-6 || Math.abs(last[1] - pt[1]) > 1e-6) {
            coords.push(pt);
          }
        }
      }
      return {
        nodeIds: r.nodes,
        nodeNames: r.nodes.map((id) => getNode(id)?.name ?? id),
        edgeIds: r.edges,
        minutes: r.minutes,
        km: +r.km.toFixed(2),
        coords,
      } satisfies EnumeratedRoute;
    });
}

// k alternative paths by removing one edge at a time from the previous best (Yen-lite)
export function kAlternatives(
  start: string,
  end: string,
  k: number,
  blocked: Set<string> = new Set(),
): PathResult[] {
  const results: PathResult[] = [];
  const seen = new Set<string>();
  const first = shortestPath(start, end, blocked);
  if (!first) return results;
  results.push(first);
  seen.add(first.edgeIds.join(","));
  for (let i = 1; i < k; i++) {
    const last = results[results.length - 1];
    if (!last) break;
    let best: PathResult | null = null;
    for (const eid of last.edgeIds) {
      const b = new Set(blocked);
      b.add(eid);
      const r = shortestPath(start, end, b);
      if (r && !seen.has(r.edgeIds.join(","))) {
        seen.add(r.edgeIds.join(","));
        if (!best || r.minutes < best.minutes) best = r;
      }
    }
    if (!best) break;
    results.push(best);
  }
  return results;
}
