#!/usr/bin/env python3
"""Dijkstra-based detour finder. Input: blocked edge ids (comma). Output: JSON."""
import argparse, heapq, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPH = os.path.join(HERE, "road_graph.json")

def load():
    with open(GRAPH) as f:
        g = json.load(f)
    nodes = {n["id"]: n for n in g["nodes"]}
    adj = {n["id"]: [] for n in g["nodes"]}
    for e in g["edges"]:
        adj[e["from"]].append(e)
    # undirected
    for e in g["edges"]:
        adj[e["to"]].append({**e, "from": e["to"], "to": e["from"]})
    return nodes, adj, g["edges"]

def dijkstra(start, end, blocked):
    nodes, adj, _ = load()
    dist = {start: 0}
    prev = {}
    pq = [(0, start)]
    visited = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in visited:
            continue
        visited.add(u)
        if u == end:
            break
        for e in adj.get(u, []):
            if e["id"] in blocked:
                continue
            v = e["to"]
            nd = d + e["minutes"]
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = (u, e["id"])
                heapq.heappush(pq, (nd, v))
    if end not in dist:
        return None
    # reconstruct
    node_ids, edge_ids = [], []
    cur = end
    while cur != start:
        node_ids.insert(0, cur)
        u, eid = prev[cur]
        edge_ids.insert(0, eid)
        cur = u
    node_ids.insert(0, start)
    km = sum(next(x["km"] for x in load()[2] if x["id"] == eid.replace("r","")), 0) if False else 0
    # km from original edge list
    all_edges = load()[2]
    km = 0.0
    for eid in edge_ids:
        base = eid.replace("r", "")
        km += next((x["km"] for x in all_edges if x["id"] == base), 0.0)
    return {"node_ids": node_ids, "edge_ids": edge_ids, "minutes": round(dist[end], 1), "km": round(km, 2)}

def k_alternatives(start, end, k, blocked):
    res = []
    seen = set()
    first = dijkstra(start, end, blocked)
    if not first:
        return res
    res.append(first)
    seen.add(",".join(first["edge_ids"]))
    for _ in range(1, k):
        last = res[-1]
        best = None
        for eid in last["edge_ids"]:
            b = set(blocked) | {eid}
            r = dijkstra(start, end, b)
            if r and ",".join(r["edge_ids"]) not in seen:
                seen.add(",".join(r["edge_ids"]))
                if best is None or r["minutes"] < best["minutes"]:
                    best = r
        if not best:
            break
        res.append(best)
    return res

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="SILK")
    ap.add_argument("--end", default="BELL")
    ap.add_argument("--blocked", default="", help="comma-separated edge ids")
    ap.add_argument("--k", type=int, default=3)
    args = ap.parse_args()
    blocked = set()
    for x in args.blocked.split(","):
        x = x.strip()
        if x:
            blocked.add(x)
            blocked.add(x + "r")
    alts = k_alternatives(args.start, args.end, args.k, blocked)
    print(json.dumps({"start": args.start, "end": args.end, "blocked": sorted(blocked),
                      "alternatives": alts}, indent=2))

if __name__ == "__main__":
    main()
