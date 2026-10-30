import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { NODES, getNode } from "@/lib/road-graph";
import { enumerateAllRoutes, type EnumeratedRoute } from "@/lib/dijkstra";

export const Route = createFileRoute("/routes")({
  head: () => ({
    meta: [
      { title: "NammaMayor OS — Shortest path engine" },
      {
        name: "description",
        content:
          "Every candidate corridor mapped, exhaustively scanned and ranked — the shortest route highlighted and animated live on a dark Bengaluru map.",
      },
      { property: "og:title", content: "NammaMayor OS — Shortest path engine" },
      {
        property: "og:description",
        content: "All routes mapped, shortest found, animated live on a dark Bengaluru map.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RouteEngine,
});

const BLUE = "#2f7cf6";
const BLUE_GLOW = "#3b82f6";
const GREEN = "#22c55e";

const viaLabel = (r: EnumeratedRoute) => {
  const mid = r.nodeNames.slice(1, -1);
  if (!mid.length) return "non-stop corridor";
  if (mid.length === 1) return `via ${mid[0]}`;
  if (mid.length === 2) return `via ${mid.join(" · ")}`;
  return `via ${mid.slice(0, 2).join(" · ")} +${mid.length - 2}`;
};

function RouteEngine() {
  // ---- state ---------------------------------------------------------------
  const [originId, setOriginId] = useState("SILK");
  const [destinationId, setDestinationId] = useState("BELL");
  const [selIndex, setSelIndex] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [ready, setReady] = useState(false);

  // exhaustive scan of every simple path, shortest first
  const routes = useMemo(
    () => enumerateAllRoutes(originId, destinationId),
    [originId, destinationId],
  );
  const [scanMs, setScanMs] = useState<number | null>(null);
  useEffect(() => {
    const t0 = performance.now();
    enumerateAllRoutes(originId, destinationId); // tiny graph — re-run purely for the timing readout
    setScanMs(Math.max(0.1, +(performance.now() - t0).toFixed(2)));
  }, [originId, destinationId]);

  useEffect(() => setSelIndex(0), [originId, destinationId]);

  const sel = Math.min(selIndex, routes.length - 1);
  const selected = sel >= 0 ? routes[sel] : undefined;
  const best = routes[0];

  // ---- refs ----------------------------------------------------------------
  const mapEl = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);

  // ---- map init (browser only) ---------------------------------------------
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !mapEl.current || map.current) return;
      const lf = (mod.default ?? mod) as typeof Leaflet;
      L.current = lf;
      const BOUND = lf.latLngBounds(lf.latLng(12.7, 77.3), lf.latLng(13.3, 77.9));
      const m = lf
        .map(mapEl.current, {
          zoomControl: true,
          attributionControl: true,
          maxBounds: BOUND,
          maxBoundsViscosity: 0.9,
          minZoom: 9,
          maxZoom: 18,
        })
        .setView([12.92, 77.64], 13);
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
        className: "dark-tiles-deep",
      }).addTo(m);
      layer.current = lf.layerGroup().addTo(m);
      map.current = m;
      setReady(true);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
      setReady(false);
    };
  }, []);

  // ---- fit bounds to the route corridor ------------------------------------
  useEffect(() => {
    const lf = L.current;
    const m = map.current;
    if (!ready || !lf || !m || !routes.length) return;
    const pts: [number, number][] = [];
    for (const r of routes.slice(0, 8)) pts.push(...r.coords);
    m.fitBounds(lf.latLngBounds(pts), { padding: [90, 90], maxZoom: 14 });
  }, [ready, routes]);

  // ---- paint: blue alternatives + ANIMATED green shortest -------------------
  useEffect(() => {
    const lf = L.current;
    const g = layer.current;
    if (!ready || !lf || !g || !routes.length) return;

    g.clearLayers();
    const timers: ReturnType<typeof setTimeout>[] = [];

    // 1. all other candidate corridors — blue, staggered fade-in
    routes
      .filter((_, i) => i !== sel)
      .slice(0, 7)
      .forEach((r, idx) => {
        const line = lf
          .polyline(r.coords, {
            color: BLUE,
            weight: 4,
            opacity: 0,
            lineCap: "round",
            lineJoin: "round",
          })
          .addTo(g)
          .bindTooltip(`${viaLabel(r)} · ${r.minutes.toFixed(1)} min · ${r.km.toFixed(1)} km`, {
            sticky: true,
          });
        line.on("click", () => setSelIndex(routes.indexOf(r)));
        timers.push(setTimeout(() => line.setStyle({ opacity: 0.65 }), 120 + idx * 110));
      });

    // 2. selected route — green, draws itself origin → destination
    const selRoute = routes[sel];
    if (selRoute && selRoute.coords.length >= 2) {
      // finished-state layers get added when the draw animation ends
      const finish = (head: [number, number]) => {
        lf.polyline(selRoute.coords, {
          color: GREEN,
          weight: 13,
          opacity: 0.22,
          interactive: false,
        }).addTo(g);
        lf.polyline(selRoute.coords, {
          color: GREEN,
          weight: 7,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(g);
        lf.polyline(selRoute.coords, {
          color: "#bbf7d0",
          weight: 2.5,
          opacity: 0.9,
          className: "route-flow-line",
          interactive: false,
        }).addTo(g);
        // destination pulse dot
        lf.marker(head, {
          icon: lf.divIcon({
            className: "",
            html: `<span class="relative flex h-4 w-4"><span class="pulse-ring absolute inset-0 rounded-full bg-red-500"></span><span class="relative h-4 w-4 rounded-full bg-red-500 ring-2 ring-white"></span></span>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
          interactive: false,
        }).addTo(g);
      };

      // origin pin (green)
      const originNode = getNode(originId);
      if (originNode) {
        lf.marker([originNode.lat, originNode.lng], {
          icon: lf.divIcon({
            className: "",
            html: `<div class="route-pin-pop flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 ring-4 ring-emerald-400/40 shadow-2xl border-2 border-white"><span class="h-2.5 w-2.5 rounded-full bg-white"></span></div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
          interactive: false,
        }).addTo(g);
      }

      // moving tracer while the line draws
      const tracerIcon = lf.divIcon({
        className: "",
        html: `<div class="relative flex h-5 w-5 items-center justify-center">
          <span class="absolute h-5 w-5 rounded-full bg-emerald-400 tracer-beacon"></span>
          <span class="relative h-2.5 w-2.5 rounded-full bg-white border border-emerald-600"></span>
        </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      const tracer = lf
        .marker(selRoute.coords[0]!, { icon: tracerIcon, interactive: false })
        .addTo(g);

      const total = selRoute.coords.length;
      const drawMs = Math.min(2800, 1000 + total * 110);
      const t0 = Date.now();
      let partial: Leaflet.Polyline | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const easedAt = (p: number) => 1 - Math.pow(1 - p, 2.4);
      const tick = () => {
        const p = Math.min(1, (Date.now() - t0) / drawMs);
        const n = Math.max(2, Math.round(total * easedAt(p)));
        const seg = selRoute.coords.slice(0, n);
        if (!partial) {
          partial = lf
            .polyline(seg, {
              color: GREEN,
              weight: 7,
              opacity: 0.95,
              lineCap: "round",
              lineJoin: "round",
              interactive: false,
            })
            .addTo(g);
        } else {
          partial.setLatLngs(seg);
        }
        tracer.setLatLng(seg[seg.length - 1]!);
        if (p < 1) {
          timer = setTimeout(tick, 30);
        } else {
          finish(seg[seg.length - 1]!);
          tracer.remove();
        }
      };
      tick();
    }

    return () => {
      if (timer) clearTimeout(timer);
      timers.forEach(clearTimeout);
    };
  }, [ready, routes, sel, animKey, originId]);

  // ---- render ----------------------------------------------------------------
  return (
    <div className="relative h-screen w-full overflow-hidden">
      <div ref={mapEl} className="absolute inset-0 z-0" />

      {/* floating command panel */}
      <aside className="absolute left-4 top-4 z-[1000] flex max-h-[calc(100vh-2rem)] w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-sm border bg-background/95 shadow-2xl backdrop-blur">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
              ◣ NammaMayor
            </div>
            <div className="mt-0.5 text-sm font-bold">Shortest Path Engine</div>
          </div>
          <Link
            to="/command"
            className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-accent"
          >
            ← COMMAND
          </Link>
        </header>

        <div className="grid grid-cols-2 gap-2 border-b px-4 py-3">
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Origin
            </span>
            <select
              value={originId}
              onChange={(e) => {
                if (e.target.value === destinationId) setDestinationId(originId);
                setOriginId(e.target.value);
              }}
              className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-accent"
            >
              {NODES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Destination
            </span>
            <select
              value={destinationId}
              onChange={(e) => {
                if (e.target.value === originId) setOriginId(destinationId);
                setDestinationId(e.target.value);
              }}
              className="mt-1 w-full rounded-sm border bg-card px-2 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-accent"
            >
              {NODES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* scan stats */}
        <div className="flex items-center justify-between border-b bg-card/50 px-4 py-2 font-mono text-[10px]">
          <span className="text-muted-foreground">
            ALL ROUTES SCANNED: <span className="font-bold text-foreground">{routes.length}</span>
          </span>
          <span className="text-muted-foreground">
            SCAN: <span className="text-accent">{scanMs === null ? "…" : `${scanMs} ms`}</span>
          </span>
        </div>

        {/* best route banner */}
        {best && selected && (
          <div className="border-b bg-success/10 px-4 py-3">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-success">
                ★ Shortest route
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {viaLabel(selected)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-3xl font-bold leading-none text-success">
                {selected.minutes.toFixed(1)}
                <span className="text-sm text-muted-foreground"> min</span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {selected.km.toFixed(1)} km · {selected.nodeIds.length - 1} edges ·{" "}
                {selected.edgeIds.length} roads
              </span>
            </div>
            <button
              onClick={() => setAnimKey((k) => k + 1)}
              className="mt-2 w-full rounded-sm bg-primary px-3 py-1.5 font-mono text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              ↻ REPLAY ANIMATION
            </button>
          </div>
        )}

        {/* route ranking */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {routes.map((r, i) => {
            const isSel = i === sel;
            const isBest = i === 0;
            const delta = (r.minutes - (best?.minutes ?? 0)).toFixed(1);
            return (
              <button
                key={r.edgeIds.join(">")}
                onClick={() => setSelIndex(i)}
                style={{ animationDelay: `${i * 45}ms` }}
                className={`animate-in fade-in slide-in-from-left-2 mb-1 flex w-full items-center gap-2 rounded-sm border px-2.5 py-2 text-left transition-colors ${
                  isSel
                    ? "border-success bg-success/10"
                    : "border-transparent bg-card/40 hover:border-blue-500/50"
                }`}
              >
                <span
                  className={`flex h-5 w-8 shrink-0 items-center justify-center rounded-sm font-mono text-[10px] font-bold ${
                    isSel ? "bg-success text-background" : "bg-muted text-muted-foreground"
                  }`}
                >
                  #{i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[11px] font-semibold">
                    {viaLabel(r)}
                    {isBest && !isSel && (
                      <span className="ml-1.5 rounded-sm border border-success/60 px-1 text-[9px] text-success">
                        ★ SHORTEST
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {r.km.toFixed(1)} km · {r.nodeIds.length} junctions
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`block font-mono text-xs font-bold ${isSel ? "text-success" : "text-blue-400"}`}
                  >
                    {r.minutes.toFixed(1)}′
                  </span>
                  {!isBest && (
                    <span className="font-mono text-[9px] text-muted-foreground">+{delta}m</span>
                  )}
                </span>
              </button>
            );
          })}
          {!routes.length && (
            <p className="px-2 py-6 text-center font-mono text-xs text-muted-foreground">
              No corridor connects these junctions.
            </p>
          )}
        </div>

        {/* legend */}
        <footer className="flex items-center justify-between border-t px-4 py-2 font-mono text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-4 rounded bg-[#22c55e]" /> SHORTEST · CLICK BLUE TO SWITCH
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-4 rounded bg-[#2f7cf6]" /> ALL ROUTES
          </span>
        </footer>
      </aside>

      {/* on-map legend chip, like the screenshot's minimal look */}
      <div className="absolute bottom-4 left-1/2 z-[1000] -translate-x-1/2 rounded-sm border bg-background/90 px-3 py-1.5 font-mono text-[10px] text-muted-foreground shadow-lg backdrop-blur">
        {originId === destinationId
          ? "ORIGIN = DESTINATION"
          : routes.length
            ? `${routes.length} corridors scanned — green = shortest (${best?.minutes.toFixed(1)} min) · blue = others`
            : "scanning corridors…"}
      </div>
    </div>
  );
}
