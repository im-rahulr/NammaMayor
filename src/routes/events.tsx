import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CITY_EVENTS,
  EVENT_CATEGORY_META,
  RISK_META,
  estimateEventImpact,
  formatCount,
  rankEvents,
  type EventImpact,
  type RiskLevel,
} from "@/lib/city-events";
import { askQuestion, predictEventImpact, type EventImpactResult } from "@/lib/nvidia";
import { notifyAiIssue } from "@/lib/ai-toast";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "NammaMayor OS — City events impact planner" },
      {
        name: "description",
        content:
          "Ranked Bengaluru events map with AI crowd, traffic and transit impact forecasts for matches, concerts, marathons and festivals.",
      },
      { property: "og:title", content: "NammaMayor OS — City events impact planner" },
      {
        property: "og:description",
        content:
          "Top upcoming Bengaluru events mapped with AI crowd, traffic and transit impact forecasts.",
      },
      { property: "og:type", content: "website" },
      { property: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventsPage,
});

type Report = EventImpactResult;

const formatWhen = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Schedule TBC";
  return date.toLocaleString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
};

function Panel({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-sm border bg-card/70 p-3 ${className ?? ""}`}>
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <span aria-hidden>{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold leading-tight text-foreground">{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function RiskBar({ score, level }: { score: number; level: RiskLevel }) {
  const meta = RISK_META[level];
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between font-mono text-[10px]">
        <span className="text-muted-foreground">COMPOSITE RISK</span>
        <span className={`font-bold ${meta.text}`}>
          {score}/100 · {meta.label}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${meta.bar} transition-all`}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}

function InflowChart({ impact }: { impact: EventImpact }) {
  const data = impact.crowd.inflow.map((phase) => ({
    phase: phase.phase,
    people: phase.people,
  }));

  return (
    <div className="mt-2 h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="inflowFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="phase"
            tick={{ fill: "var(--muted-foreground)", fontSize: 9, fontFamily: "JetBrains Mono" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            formatter={(value) => [`${formatCount(Number(value))} people`, "Arrivals"]}
            contentStyle={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 2,
              fontSize: 11,
              fontFamily: "JetBrains Mono",
              color: "var(--foreground)",
            }}
          />
          <Area
            type="monotone"
            dataKey="people"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#inflowFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventsPage() {
  const ranked = useMemo(() => rankEvents(CITY_EVENTS), []);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(() => ranked[0]?.event.id ?? "");
  const [reports, setReports] = useState<Record<string, Report>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());
  const [briefings, setBriefings] = useState<
    Record<string, { loading?: boolean; text?: string; error?: string }>
  >({});

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layerRef = useRef<Leaflet.LayerGroup | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(({ event }) =>
      [
        event.title,
        event.venue,
        event.locationName,
        event.zone,
        EVENT_CATEGORY_META[event.category].label,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [ranked, query]);

  const selected = useMemo(
    () => ranked.find((item) => item.event.id === selectedId)?.event ?? ranked[0]?.event ?? null,
    [ranked, selectedId],
  );

  // Instant deterministic estimate — replaced by the agent report when it lands.
  const fallback = useMemo<Report | null>(
    () =>
      selected
        ? {
            ...estimateEventImpact(selected),
            model: "deterministic-model",
            latencyMs: 0,
          }
        : null,
    [selected],
  );

  const impact = selected ? (reports[selected.id] ?? fallback) : fallback;
  const briefing = selected ? briefings[selected.id] : undefined;
  const isLoading = Boolean(selected && loadingId === selected.id);

  // ── Map bootstrap ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      const L = (mod.default ?? mod) as typeof Leaflet;
      leafletRef.current = L;

      const map = L.map(mapEl.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 10,
        maxZoom: 18,
      }).setView([12.9716, 77.5946], 12);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · event fixtures are simulated',
        maxZoom: 19,
        className: "dark-tiles",
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      leafletRef.current = null;
      setMapReady(false);
    };
  }, []);

  // ── Draw markers + selected impact perimeter ───────────────────────────────
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer || !mapReady) return;

    layer.clearLayers();

    for (const item of ranked) {
      const { event, level } = item;
      const risk = RISK_META[level];
      const meta = EVENT_CATEGORY_META[event.category];
      const isSelected = event.id === selectedId;

      if (isSelected) {
        L.circle([event.lat, event.lng], {
          radius: event.radiusM,
          color: risk.hex,
          weight: 2,
          fillColor: risk.hex,
          fillOpacity: 0.12,
          dashArray: "6 8",
        }).addTo(layer);
        L.circle([event.lat, event.lng], {
          radius: 180,
          color: risk.hex,
          weight: 1,
          fillColor: risk.hex,
          fillOpacity: 0.25,
        }).addTo(layer);
      }

      const icon = L.divIcon({
        className: "",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:${
          isSelected ? 34 : 28
        }px;height:${isSelected ? 34 : 28}px;border-radius:9999px;background:${
          risk.hex
        };border:2px solid #0b1220;box-shadow:0 0 14px ${
          risk.hex
        };font-size:${isSelected ? 16 : 13}px;opacity:${isSelected ? 1 : 0.85}">${meta.icon}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      L.marker([event.lat, event.lng], { icon, zIndexOffset: isSelected ? 1000 : 0 })
        .addTo(layer)
        .bindTooltip(`${event.title} · ${risk.label}`, { direction: "top", offset: [0, -14] })
        .on("click", () => setSelectedId(event.id));
    }

    const focus = ranked.find((item) => item.event.id === selectedId)?.event;
    if (focus) map.flyTo([focus.lat, focus.lng], 14, { duration: 0.8 });
  }, [mapReady, ranked, selectedId]);

  // ── Fetch the AI agent report for the selected event (cached per event) ────
  useEffect(() => {
    if (!selected || reports[selected.id] || inFlight.current.has(selected.id)) return;
    const event = selected;
    inFlight.current.add(event.id);
    setLoadingId(event.id);

    const retryReport = () =>
      setReports((prev) => {
        const next = { ...prev };
        delete next[event.id];
        return next;
      });

    predictEventImpact({ data: event })
      .then((result) => {
        setReports((prev) => ({ ...prev, [event.id]: result }));
        // The server falls back to the deterministic model on AI failure; pop
        // the reason (rate limit, quota, timeout…) instead of hiding it.
        if (result.notice) notifyAiIssue(result.notice, { retry: retryReport });
      })
      .catch((error: unknown) => {
        // Deterministic fallback is already on screen, but surface why AI failed.
        notifyAiIssue(error, { retry: retryReport });
      })
      .finally(() => {
        inFlight.current.delete(event.id);
        setLoadingId((current) => (current === event.id ? null : current));
      });
  }, [selected, reports]);

  const refreshReport = () => {
    if (!selected) return;
    setReports((prev) => {
      const next = { ...prev };
      delete next[selected.id];
      return next;
    });
  };

  const runBriefing = async () => {
    if (!selected) return;
    const event = selected;
    setBriefings((prev) => ({ ...prev, [event.id]: { loading: true } }));

    const question = [
      `Draft a pre-event operations brief for "${event.title}" at ${event.venue} (${event.locationName}, ${event.zone} zone, Bengaluru).`,
      `Starts ${formatWhen(event.startsAt)} IST. Expected attendance ${formatCount(event.expectedAttendance)} of ${formatCount(event.venueCapacity)} capacity.`,
      `Roads under pressure: ${event.nearbyArterials.join(", ")}. Nearest transit: ${event.transitHub}.`,
      "Give exactly five operational bullets covering crowd flow, traffic diversion, transit surge, emergency access, and a go/no-go trigger.",
    ].join("\n");

    try {
      const result = await askQuestion({
        data: {
          question,
          systemPrompt:
            "You are the pre-event planning advisor for Bengaluru City Command Center (NammaMayor OS). Reply in tight, specific operational bullets with road names and timings. No preamble.",
          maxTokens: 900,
        },
      });
      setBriefings((prev) => ({
        ...prev,
        [event.id]: { text: result.content || result.reasoning || "No briefing returned." },
      }));
    } catch (error) {
      setBriefings((prev) => ({
        ...prev,
        [event.id]: {
          error: error instanceof Error ? error.message : "Briefing request failed.",
        },
      }));
      notifyAiIssue(error, { retry: () => void runBriefing() });
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 font-mono text-xs">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold tracking-[0.25em] text-accent">
            NAMMAMAYOR<span className="text-muted-foreground">OS</span>
          </Link>
          <span className="hidden rounded-sm border border-accent/40 px-2 py-1 text-accent md:inline">
            CITY EVENTS
          </span>
          <span className="hidden text-muted-foreground md:inline">
            Impact planner · {CITY_EVENTS.length} upcoming fixtures
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/command"
            className="rounded-sm border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-accent hover:text-accent"
          >
            OPEN COMMAND CENTER →
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Ranked event list */}
        <aside className="flex w-[22rem] shrink-0 flex-col border-r bg-card/60">
          <div className="space-y-2 border-b p-3">
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Top events by impact</span>
              <span className="text-accent">{filtered.length}</span>
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter venue, road, category…"
              className="w-full rounded-sm border bg-background/60 px-2.5 py-1.5 font-mono text-xs outline-none placeholder:text-muted-foreground/70 focus:border-accent"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <p className="p-3 font-mono text-xs text-muted-foreground">
                No events match “{query}”.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {filtered.map(({ event, score, level }, index) => {
                  const active = event.id === selected?.id;
                  const category = EVENT_CATEGORY_META[event.category];
                  const risk = RISK_META[level];
                  return (
                    <li key={event.id}>
                      <button
                        onClick={() => setSelectedId(event.id)}
                        className={`w-full rounded-sm border p-2.5 text-left transition-colors ${
                          active
                            ? "border-accent/70 bg-accent/10"
                            : "border-border/60 bg-background/40 hover:border-border hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-[9px] text-muted-foreground">
                            #{String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className={`rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider ${risk.chip}`}
                          >
                            {risk.label} {score}
                          </span>
                        </div>
                        <div className="mt-1 flex items-start gap-1.5">
                          <span aria-hidden className="text-sm leading-5">
                            {category.icon}
                          </span>
                          <span className="text-[13px] font-semibold leading-5 text-foreground">
                            {event.title}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {event.venue} · {event.zone}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                          {formatWhen(event.startsAt)} · {formatCount(event.expectedAttendance)} pax
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t p-3 font-mono text-[9px] leading-relaxed text-muted-foreground">
            Demo fixture set · schedules and attendances are simulated for the NammaMayor OS
            prototype, not a live ticketing feed.
          </div>
        </aside>

        {/* Map + impact detail */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-[260px] flex-1">
            <div ref={mapEl} className="absolute inset-0 z-0" />
            <div className="pointer-events-none absolute left-3 top-3 z-[400] rounded-sm border border-border/70 bg-card/85 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground backdrop-blur">
              <span className="text-accent">●</span> impact perimeter · ranked by crowd × road load
            </div>
          </div>

          {selected && impact ? (
            <section className="flex h-[47%] shrink-0 flex-col overflow-y-auto border-t bg-card/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider ${EVENT_CATEGORY_META[selected.category].chip}`}
                    >
                      {EVENT_CATEGORY_META[selected.category].icon}{" "}
                      {EVENT_CATEGORY_META[selected.category].label}
                    </span>
                    <span
                      className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider ${RISK_META[impact.risk.level].chip}`}
                    >
                      {RISK_META[impact.risk.level].label} RISK
                    </span>
                    <span
                      className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] tracking-wider ${
                        impact.source === "agent"
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-border bg-muted/40 text-muted-foreground"
                      }`}
                    >
                      {isLoading
                        ? "AI AGENT THINKING…"
                        : impact.source === "agent"
                          ? "AI AGENT REPORT"
                          : "MODEL ESTIMATE"}
                    </span>
                  </div>
                  <h2 className="mt-2 text-xl font-bold leading-tight">{selected.title}</h2>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {selected.venue} · {selected.locationName} · {formatWhen(selected.startsAt)} IST
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={refreshReport}
                    disabled={isLoading}
                    className="rounded-sm border border-accent/60 px-3 py-1.5 font-mono text-[10px] font-bold tracking-wider text-accent transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                  >
                    ↻ REFRESH AI REPORT
                  </button>
                  <button
                    onClick={runBriefing}
                    disabled={briefing?.loading}
                    className="rounded-sm border border-border px-3 py-1.5 font-mono text-[10px] tracking-wider text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                  >
                    {briefing?.loading ? "DRAFTING…" : "OPS BRIEFING"}
                  </button>
                </div>
              </div>

              {impact.notice ? (
                <p className="mt-2 rounded-sm border border-yellow-400/30 bg-yellow-400/5 px-2.5 py-1.5 font-mono text-[10px] text-yellow-400/90">
                  {impact.notice}
                </p>
              ) : null}

              {briefing ? (
                <div className="mt-3 rounded-sm border border-primary/40 bg-primary/5 p-3">
                  <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
                    Ops briefing
                  </div>
                  {briefing.error ? (
                    <p className="font-mono text-[11px] text-destructive">{briefing.error}</p>
                  ) : briefing.loading ? (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      Drafting a five-bullet pre-event brief…
                    </p>
                  ) : (
                    <p className="whitespace-pre-line text-[12px] leading-relaxed text-foreground/90">
                      {briefing.text}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <Panel title="Crowd inflow" icon="👥">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat
                      label="Expected"
                      value={formatCount(impact.crowd.expected)}
                      hint="people"
                    />
                    <Stat
                      label="Peak concurrent"
                      value={formatCount(impact.crowd.peakConcurrent)}
                      hint={`${Math.round((impact.crowd.peakConcurrent / Math.max(1, selected.venueCapacity)) * 100)}% of capacity`}
                    />
                  </div>
                  <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {impact.crowd.gatePressure}
                  </p>
                  <InflowChart impact={impact} />
                  <p className="text-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    Arrival wave · hours before start
                  </p>
                </Panel>

                <Panel title="Traffic impact" icon="🚦">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat
                      label="Added load"
                      value={`${formatCount(impact.traffic.addedPcuPerHour)}`}
                      hint="PCU/h"
                    />
                    <Stat
                      label="Parking demand"
                      value={formatCount(impact.traffic.parkingDemand)}
                      hint="vehicles"
                    />
                  </div>
                  <ul className="mt-2 space-y-1">
                    {impact.traffic.corridors.map((corridor) => (
                      <li
                        key={corridor.corridor}
                        className="flex items-start justify-between gap-2 border-b border-border/40 pb-1 last:border-0 last:pb-0"
                      >
                        <div>
                          <div className="text-[11px] font-semibold leading-4">
                            {corridor.corridor}
                          </div>
                          <div className="font-mono text-[9px] leading-3 text-muted-foreground">
                            {corridor.note}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-sm border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-destructive">
                          +{corridor.addedMin} min
                        </span>
                      </li>
                    ))}
                  </ul>
                  {impact.traffic.closures.length ? (
                    <div className="mt-2 rounded-sm border border-destructive/30 bg-destructive/5 p-2 font-mono text-[10px] text-destructive">
                      {impact.traffic.closures.join(" ")}
                    </div>
                  ) : null}
                </Panel>

                <div className="space-y-3">
                  <Panel title="Network risk" icon="⚠️">
                    <RiskBar score={impact.risk.score} level={impact.risk.level} />
                    <ul className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      {impact.risk.concerns.map((concern) => (
                        <li key={concern} className="flex gap-1.5">
                          <span className="text-destructive">▸</span>
                          <span>{concern}</span>
                        </li>
                      ))}
                    </ul>
                  </Panel>

                  <Panel title="Transit + actions" icon="🚌">
                    <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
                      <span className="text-accent">METRO</span> {impact.transit.metroSurge}
                    </p>
                    <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      <span className="text-primary">BMTC</span> {impact.transit.bmtc}
                    </p>
                    <ol className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed text-foreground/90">
                      {impact.risk.actions.map((action, i) => (
                        <li key={action} className="flex gap-1.5">
                          <span className="text-success">{i + 1}.</span>
                          <span>{action}</span>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                </div>
              </div>

              <p className="mt-3 border-t border-border/50 pt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                <span className="text-foreground/80">Summary · </span>
                {impact.summary}
              </p>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}
