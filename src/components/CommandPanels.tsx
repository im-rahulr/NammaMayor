import { useEffect, useRef, useState, useCallback } from "react";

import { getNews } from "@/lib/news";
import {
  askQuestion,
  agentChat,
  supervisorReport,
  DEFAULT_QUESTION,
  AGENT_TURN_ORDER,
  type QuestionResult,
  type AgentMessage,
  type SupervisorReport,
} from "@/lib/nvidia";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { NewsItem } from "@/lib/news-rss";
import { notifyAiIssue } from "@/lib/ai-toast";

type Feed = { t: string; agent: string; msg: string; tone: "sys" | "agent" | "warn" | "ok" };

export type MarkedEventInfo = {
  id: string;
  type: string;
  typeName: string;
  icon: string;
  title: string;
  locationName: string;
  lat: number;
  lng: number;
  radiusM: number;
  severity: "CRITICAL" | "HIGH" | "ELEVATED";
  timestamp: string;
  description: string;
  workStatus?: {
    prediction: string;
    forecast: string;
    mobility: string;
    safety: string;
    comms: string;
  };
};

type Props = {
  feed: Feed[];
  depth: Record<string, number>;
  zones: { id: string; name: string }[];
  live: boolean;
  mode: string;
  markedEvent?: MarkedEventInfo | null;
  onClearEvent?: () => void;
};

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

// The server-side agents only need the incident facts, not the map/UI metadata.
const toEventInput = (ev: MarkedEventInfo) => ({
  type: ev.type,
  typeName: ev.typeName,
  locationName: ev.locationName,
  lat: ev.lat,
  lng: ev.lng,
  severity: ev.severity,
  description: ev.description,
});

// Agent colour map — kept in sync with AgentId in nvidia.ts
const AGENT_COLORS: Record<string, string> = {
  prediction: "text-accent",
  FORECAST: "text-primary",
  MOBILITY: "text-success",
  SAFETY: "text-destructive",
  COMMS: "text-cyan-400",
};
const AGENT_LIST = Object.keys(AGENT_COLORS);

// How long to wait between real API turns (ms). Shorter when live; longer when paused.
const LIVE_INTERVAL_MS = 6_000;
const PAUSED_CHECK_MS = 2_000;

type Log = { t: string; level: "INFO" | "WARN" | "OK"; text: string };
type NewsState = {
  items: NewsItem[];
  sources: string[];
  updatedAt: string | null;
  loading: boolean;
  error: string | null;
};

const NEWS_REFRESH_MS = 60_000;

const ago = (iso: string | null) => {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const isBreaking = (iso: string | null) =>
  !!iso && Date.now() - Date.parse(iso) < 3 * 60 * 60 * 1000;

const PRESET_QUESTIONS = [
  "How should traffic be diverted if Silk Board junction is blocked by waterlogging?",
  "What is the priority clearance corridor for emergency ambulances from St. John's to HSR?",
  "Recommend BMTC bus fleet rerouting strategy during an Outer Ring Road closure.",
  "What is the crowd dispersion and safety cordon protocol for a gas leak near HSR Sector 2?",
];

function Panel({
  title,
  count,
  children,
  className = "",
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-sm border bg-card/60 ${className}`}>
      <header className="flex items-center justify-between border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em]">
        <span>{title}</span>
        {count !== undefined && (
          <span className="rounded-sm bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {count}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 font-mono text-xs">{children}</div>
    </section>
  );
}

function ReportList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <div className={`text-[9px] font-bold uppercase tracking-[0.2em] ${tone}`}>{title}</div>
      <ul className="mt-1 space-y-1">
        {items.map((item, k) => (
          <li key={k} className="flex gap-1.5 text-[10px] leading-relaxed">
            <span className={tone}>▸</span>
            <span className="text-muted-foreground">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionPanel() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const handleAsk = async (customQuestion?: string) => {
    const q = (customQuestion ?? question).trim();
    if (!q || busy) return;
    setBusy(true);
    reset();
    try {
      setResult(await askQuestion({ data: { question: q } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Question request failed.");
      notifyAiIssue(err, { retry: () => void handleAsk(q) });
    } finally {
      setBusy(false);
    }
  };

  const handlePreset = (preset: string) => {
    setQuestion(preset);
    void handleAsk(preset);
  };

  return (
    <section className="rounded-sm border bg-card/60">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em]">
        <span>◉ OPERATIONS AI · ADVISORY ASSISTANT</span>
        <span className="text-[10px] font-normal tracking-widest text-muted-foreground">
          {result?.model ?? "NVIDIA NIM AI"}
        </span>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        {/* controls & input */}
        <div className="space-y-3 font-mono text-xs">
          <div>
            <label className="block text-[10px] font-bold tracking-widest text-muted-foreground">
              OPERATIONAL QUESTION / INQUIRY
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void handleAsk();
                }
              }}
              rows={4}
              placeholder="Type your operational question (e.g. detour routing, emergency protocols, corridor clearance)..."
              className="mt-1.5 w-full resize-none rounded-sm border bg-background/60 px-3 py-2 text-[11px] tracking-normal text-foreground outline-none focus:border-accent"
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Press Ctrl+Enter to ask</span>
              <span>{question.length} chars</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-[10px] tracking-widest text-muted-foreground">
              QUICK SCENARIOS / PRESET QUESTIONS:
            </span>
            <div className="flex flex-col gap-1.5">
              {PRESET_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handlePreset(q)}
                  disabled={busy}
                  className="rounded-sm border bg-background/40 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  › {q}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleAsk()}
              disabled={!question.trim() || busy}
              className="flex-1 rounded-sm bg-primary py-2.5 text-[10px] font-bold tracking-[0.2em] text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {busy ? "QUERYING ADVISOR…" : "▶ ASK QUESTION"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setQuestion("");
              }}
              disabled={busy || (!question && !result && !error)}
              className="rounded-sm border px-3 py-2.5 text-[10px] tracking-widest text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-40"
            >
              ✕ CLEAR
            </button>
          </div>
        </div>

        {/* output */}
        <div className="flex min-h-[320px] flex-col rounded-sm border bg-background/50 p-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b pb-2 text-[10px] tracking-widest text-muted-foreground">
            <span>ADVISOR RESPONSE</span>
            <span>
              {result
                ? `${result.latencyMs} MS${result.usage ? ` · ${result.usage.completionTokens} TOK` : ""}`
                : busy
                  ? "PROCESSING"
                  : "IDLE"}
            </span>
          </div>

          <div className="mt-3 flex-1 space-y-3 overflow-y-auto">
            {busy && (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((k) => (
                  <div
                    key={k}
                    className="h-3 animate-pulse rounded-sm bg-muted"
                    style={{ width: `${90 - k * 12}%` }}
                  />
                ))}
                <p className="pt-2 text-[10px] tracking-widest text-muted-foreground">
                  CONSULTING NVIDIA NIM INTELLIGENCE MODEL…
                </p>
              </div>
            )}

            {!busy && error && (
              <div className="border-l-2 border-destructive pl-3 text-destructive">
                <div className="text-[10px] tracking-widest">REQUEST FAILED</div>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed">{error}</p>
                <button
                  onClick={() => void handleAsk()}
                  className="mt-3 rounded-sm border px-2 py-1 text-[10px] tracking-widest hover:border-accent hover:text-accent"
                >
                  ↻ RETRY
                </button>
              </div>
            )}

            {!busy && !error && !result && (
              <p className="text-[10px] leading-relaxed tracking-widest text-muted-foreground">
                Ask any question regarding crisis operations, traffic rerouting, corridor clearance,
                or resource coordination. Select a preset scenario or enter custom inquiries above.
              </p>
            )}

            {!busy && result && (
              <>
                {result.reasoning && (
                  <details className="rounded-sm border border-dashed p-2 text-muted-foreground">
                    <summary className="cursor-pointer text-[10px] tracking-widest">
                      REASONING TRACE
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed">
                      {result.reasoning}
                    </p>
                  </details>
                )}
                <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">
                  {result.content || "(no response text — see reasoning trace)"}
                </div>
                <p className="border-t pt-2 text-[10px] tracking-widest text-muted-foreground">
                  {result.model}
                  {result.usage ? ` · ${result.usage.promptTokens} PROMPT TOK` : ""}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function CommandPanels({
  feed,
  depth,
  zones,
  live,
  mode,
  markedEvent,
  onClearEvent,
}: Props) {
  const [msgs, setMsgs] = useState<AgentMessage[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [paused, setPaused] = useState(false);
  // turnIndex tracks position in AGENT_TURN_ORDER (0-4)
  const turnIndexRef = useRef(0);
  // Track last message text for the next agent's context
  const lastMsgRef = useRef("");
  const chatEnd = useRef<HTMLDivElement>(null);
  const [cctvOpen, setCctvOpen] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  // Supervisor incident report, issued after a full 5-agent cycle.
  const [report, setReport] = useState<SupervisorReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  // Mirror of `msgs` so the burst can read the finished thread without
  // re-creating its callbacks on every incoming message.
  const threadRef = useRef<AgentMessage[]>([]);
  useEffect(() => {
    threadRef.current = msgs;
  }, [msgs]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const markedEventRef = useRef(markedEvent);
  markedEventRef.current = markedEvent;
  const [news, setNews] = useState<NewsState>({
    items: [],
    sources: [],
    updatedAt: null,
    loading: true,
    error: null,
  });
  const [newsSource, setNewsSource] = useState<string | null>(null);
  const [newsNonce, setNewsNonce] = useState(0);

  // Real headlines from Google News RSS, fetched through a server function (no CORS in the browser).
  useEffect(() => {
    let cancelled = false;
    setNews((s) => ({ ...s, loading: true }));
    getNews({ data: { mode } })
      .then((payload) => {
        if (cancelled) return;
        setNews({
          items: payload.items,
          sources: payload.sources,
          updatedAt: payload.updatedAt,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setNews((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "News feed unavailable",
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [mode, newsNonce]);

  useEffect(() => {
    const id = setInterval(() => setNewsNonce((n) => n + 1), NEWS_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // ── Real API agent loop ────────────────────────────────────────────────────
  // Every turn is serialized through a promise chain, so an incident burst and
  // the background cadence never overlap or drop each other's messages.
  const turnChainRef = useRef<Promise<void>>(Promise.resolve());
  const queuedRef = useRef(false);
  const burstRef = useRef(0);
  const activeEventIdRef = useRef<string | null>(null);

  const runTurn = useCallback(() => {
    const execute = async () => {
      if (pausedRef.current) return;
      // Capture the incident this turn belongs to. If a new event is marked
      // while the call is in flight, the stale reply is discarded so the chat
      // never shows the previous scenario after the incident banner updates.
      const eventIdAtStart = activeEventIdRef.current;
      const ev = markedEventRef.current;
      setAgentError(null);
      try {
        const result = await agentChat({
          data: {
            turnIndex: turnIndexRef.current,
            lastMessage: lastMsgRef.current,
            mode: modeRef.current,
            markedEvent: ev ? toEventInput(ev) : null,
          },
        });
        if (eventIdAtStart !== activeEventIdRef.current) return;
        if (result.notice) {
          // Live model failed and a fallback answered — pop the reason, but at
          // most once a minute so the 5-agent loop cannot flood the screen.
          notifyAiIssue(result.notice, { cooldownMs: 60_000 });
        }
        const [msg] = result.messages;
        if (msg) {
          setMsgs((m) => [...m, msg].slice(-60));
          lastMsgRef.current = msg.text;

          // Build a supervisor log entry
          const ts = msg.t;
          const lat = result.latencyMs;
          const logEntry: Log =
            lat > 20_000
              ? {
                  t: ts,
                  level: "WARN",
                  text: `${msg.from} → ${msg.to}: response slow (${lat} ms), monitoring.`,
                }
              : turnIndexRef.current % 5 === 4
                ? {
                    t: ts,
                    level: "OK",
                    text: `Cycle complete. All 5 agents synchronized for active operations.`,
                  }
                : {
                    t: ts,
                    level: "INFO",
                    text: `${msg.from} → ${msg.to} · ${lat} ms · operational directive OK`,
                  };
          setLogs((l) => [logEntry, ...l].slice(0, 80));
        }
        turnIndexRef.current = (turnIndexRef.current + 1) % AGENT_TURN_ORDER.length;
      } catch (err) {
        if (eventIdAtStart !== activeEventIdRef.current) return;
        const msg = err instanceof Error ? err.message : "Agent API error";
        setAgentError(msg);
        notifyAiIssue(err, { cooldownMs: 60_000 });
        setLogs((l) =>
          [
            { t: now(), level: "WARN" as const, text: `Agent API note: ${msg.slice(0, 80)}` },
            ...l,
          ].slice(0, 80),
        );
      }
    };

    const next = turnChainRef.current.then(execute, execute);
    turnChainRef.current = next.catch(() => {});
    return next;
  }, []);

  // The supervisor reads the completed thread and pins an incident report in the
  // MONITOR AI panel. Stale replies (event cleared or replaced mid-call) drop.
  const runSupervisorReport = useCallback(async (eventId: string) => {
    const ev = markedEventRef.current;
    if (!ev || ev.id !== eventId) return;
    setReportBusy(true);
    try {
      const result = await supervisorReport({
        data: {
          markedEvent: toEventInput(ev),
          mode: modeRef.current,
          messages: threadRef.current.map((m) => ({
            from: m.from,
            to: m.to,
            text: m.text,
          })),
        },
      });
      if (activeEventIdRef.current !== eventId) return;
      if (result.notice) notifyAiIssue(result.notice, { cooldownMs: 60_000 });
      setReport(result);
      setLogs((l) =>
        [
          {
            t: result.t,
            level: "OK" as const,
            text: `SUPERVISOR REPORT ISSUED · ${result.headline} · ${result.latencyMs} ms`,
          },
          ...l,
        ].slice(0, 80),
      );
    } catch (err) {
      if (activeEventIdRef.current !== eventId) return;
      const msg = err instanceof Error ? err.message : "Supervisor report error";
      notifyAiIssue(err, { cooldownMs: 60_000 });
      setLogs((l) =>
        [
          {
            t: now(),
            level: "WARN" as const,
            text: `Supervisor report failed: ${msg.slice(0, 80)}`,
          },
          ...l,
        ].slice(0, 80),
      );
    } finally {
      if (activeEventIdRef.current === eventId) setReportBusy(false);
    }
  }, []);

  // Background cadence: one turn per tick, skipped while an incident burst runs.
  const fireTurn = useCallback(async () => {
    if (pausedRef.current || burstRef.current || queuedRef.current) return;
    queuedRef.current = true;
    try {
      await runTurn();
      const eventId = activeEventIdRef.current;
      // turnIndex wrapped back to 0, so a full cycle just closed on the open
      // incident — let the supervisor re-issue its brief against the new thread.
      if (eventId && turnIndexRef.current === 0) await runSupervisorReport(eventId);
    } finally {
      queuedRef.current = false;
    }
  }, [runTurn, runSupervisorReport]);

  // A marked event opens a fresh thread and runs one full 5-agent cycle
  // immediately, so the collision is on screen the moment it is reported.
  const runIncidentBurst = useCallback(
    async (eventId: string) => {
      // Token instead of a boolean: if a second event is marked mid-burst, the
      // old burst cannot clear the new burst's flag when it unwinds.
      const token = burstRef.current + 1;
      burstRef.current = token;
      try {
        for (let turn = 0; turn < AGENT_TURN_ORDER.length; turn += 1) {
          if (activeEventIdRef.current !== eventId) break;
          await runTurn();
          if (activeEventIdRef.current !== eventId) break;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        if (activeEventIdRef.current === eventId) await runSupervisorReport(eventId);
      } finally {
        if (burstRef.current === token) burstRef.current = 0;
      }
    },
    [runTurn, runSupervisorReport],
  );

  // When markedEvent updates, reset the thread and respond to it immediately.
  useEffect(() => {
    if (!markedEvent) {
      activeEventIdRef.current = null;
      setReport(null);
      setReportBusy(false);
      return;
    }
    if (activeEventIdRef.current === markedEvent.id) return;

    activeEventIdRef.current = markedEvent.id;
    setPaused(false);
    pausedRef.current = false;
    setReport(null);
    setReportBusy(false);

    // Seed the thread instantly with the incident's opening line so the very
    // first chat bubble already describes the collision (shown in red), then
    // let the live agents continue the conversation from there.
    const seedText = markedEvent.workStatus?.prediction?.trim();
    if (seedText) {
      setMsgs([{ from: "prediction", to: "FORECAST", text: seedText, t: now() }]);
      lastMsgRef.current = seedText;
      turnIndexRef.current = 1;
    } else {
      setMsgs([]);
      lastMsgRef.current = "";
      turnIndexRef.current = 0;
    }
    setLogs((l) =>
      [
        {
          t: now(),
          level: "WARN" as const,
          text: `🚨 INCIDENT REPORTED ON MAP: ${markedEvent.icon} ${markedEvent.typeName} at ${markedEvent.locationName}. 5 AI response team engaged!`,
        },
        ...l,
      ].slice(0, 80),
    );
    void runIncidentBurst(markedEvent.id);
  }, [markedEvent, runIncidentBurst]);

  useEffect(() => {
    const delay = live ? LIVE_INTERVAL_MS : PAUSED_CHECK_MS;
    const id = setInterval(() => {
      void fireTurn();
    }, delay);
    // Fire immediately on mount / mode change
    void fireTurn();
    return () => clearInterval(id);
  }, [live, fireTurn]);

  useEffect(() => {
    chatEnd.current?.parentElement?.scrollTo({ top: 1e6, behavior: "smooth" });
  }, [msgs]);

  const alerts = feed.filter((f) => f.tone === "warn");
  const watched = [...zones].sort((a, b) => (depth[b.id] ?? 0) - (depth[a.id] ?? 0));
  const color = (id: string) => AGENT_COLORS[id] ?? "text-foreground";
  const warns = logs.filter((l) => l.level === "WARN").length;
  const visibleNews = newsSource ? news.items.filter((n) => n.source === newsSource) : news.items;

  return (
    <div className="space-y-3 p-3">
      <div className="grid h-[520px] grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="WATCHLIST & PLAYBOOKS" count={3}>
          {[
            "Monsoon-3 · Flood evacuation",
            "Vapor-1 · Gas leak isolation",
            "Gridlock-2 · Traffic surge",
          ].map((p) => (
            <div key={p} className="mb-2 rounded-sm border border-dashed p-3">
              <div className="font-bold">{p.split(" · ")[0]}</div>
              <div className="mt-1 text-muted-foreground">{p.split(" · ")[1]}</div>
            </div>
          ))}
        </Panel>
        <Panel title="ALERT CENTER" count={alerts.length}>
          {alerts.length === 0 ? (
            <p>No alerts in the past 30 minutes.</p>
          ) : (
            alerts.map((a, k) => (
              <div key={k} className="mb-2 border-l-2 border-destructive pl-2">
                <div className="text-destructive">
                  {a.agent} · {a.t}
                </div>
                <div className="text-muted-foreground">{a.msg}</div>
              </div>
            ))
          )}
        </Panel>
        <Panel title="LIVE NEWS" count={news.items.length} className="xl:col-span-1">
          <div className="mb-3 flex flex-wrap gap-1">
            <button
              onClick={() => setNewsSource(null)}
              className={`rounded-sm border px-2 py-1 text-[10px] ${newsSource === null ? "border-destructive bg-destructive text-destructive-foreground" : ""}`}
            >
              ALL
            </button>
            {news.sources.map((c) => (
              <button
                key={c}
                onClick={() => setNewsSource(newsSource === c ? null : c)}
                className={`rounded-sm border px-2 py-1 text-[10px] ${newsSource === c ? "border-destructive bg-destructive text-destructive-foreground" : ""}`}
              >
                {c.toUpperCase()}
              </button>
            ))}
          </div>

          {news.error && news.items.length === 0 ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">News feed offline — {news.error}</p>
              <button
                onClick={() => setNewsNonce((n) => n + 1)}
                className="rounded-sm border px-2 py-1 text-[10px]"
              >
                ↻ RETRY
              </button>
            </div>
          ) : news.loading && news.items.length === 0 ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((k) => (
                <div key={k} className="h-9 animate-pulse rounded-sm bg-muted" />
              ))}
            </div>
          ) : visibleNews.length === 0 ? (
            <p className="text-muted-foreground">No headlines for this filter right now.</p>
          ) : (
            visibleNews.map((n) => (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 block border-b pb-2 last:border-0 hover:text-accent"
              >
                <div className="flex gap-1.5">
                  <span className={isBreaking(n.publishedAt) ? "text-destructive" : "text-accent"}>
                    ●
                  </span>
                  <span className="line-clamp-2">{n.title}</span>
                </div>
                <div className="mt-1 pl-3.5 text-[10px] text-muted-foreground">
                  {n.source}
                  {n.publishedAt ? ` · ${ago(n.publishedAt)}` : ""}
                </div>
              </a>
            ))
          )}

          <div className="sticky bottom-0 -mx-4 -mb-4 mt-1 flex items-center justify-between border-t bg-card/95 px-4 py-2 text-[10px] text-muted-foreground backdrop-blur">
            <span>
              {news.updatedAt
                ? `UPDATED ${new Date(news.updatedAt).toLocaleTimeString("en-GB", { hour12: false })}`
                : "CONNECTING…"}
              {news.loading && news.items.length > 0 ? " · REFRESHING" : ""}
            </span>
            <button
              onClick={() => setNewsNonce((n) => n + 1)}
              className="tracking-widest hover:text-accent"
            >
              ↻ REFRESH
            </button>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="LIVE WEBCAMS" className="h-64 xl:col-span-2">
          <div
            className="mt-2 h-[calc(100%-0.5rem)] min-h-[150px] cursor-pointer"
            onClick={() => setCctvOpen(true)}
            title="Click to expand"
          >
            <iframe
              src="https://webcams.windy.com/webcams/public/embed/player/1793900066/day?autoPlay=1&loop=1&interactive=false"
              className="pointer-events-none h-full w-full rounded-sm border"
              allow="autoplay; fullscreen"
              title="Live CCTV — Bengaluru West: Dodda Banaswadi"
            />
          </div>
          <Dialog open={cctvOpen} onOpenChange={setCctvOpen}>
            <DialogContent className="h-[90vh] w-[95vw] max-w-none p-0">
              <iframe
                src="https://webcams.windy.com/webcams/public/embed/player/1793900066/day?autoPlay=1&loop=1&interactive=false"
                className="h-full w-full rounded-sm border-0"
                allow="autoplay; fullscreen"
                allowFullScreen
                title="Live CCTV — Bengaluru West: Dodda Banaswadi"
              />
            </DialogContent>
          </Dialog>
        </Panel>
        <Panel title="WATCHED LOCATIONS" count={watched.length} className="h-64">
          {watched.map((z) => (
            <div key={z.id} className="flex justify-between border-b py-1.5">
              <span>{z.name}</span>
              <span className="text-primary">{(depth[z.id] ?? 0).toFixed(2)}</span>
            </div>
          ))}
        </Panel>
        <Panel title="LOCAL LOGISTICS" className="h-64">
          {[
            ["Ambulances", "14 / 20"],
            ["Police units", "22 / 30"],
            ["BMTC buses", "8 reserved"],
            ["Rescue boats", "3 / 4"],
            ["Shelter beds", "1,240 free"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b py-1.5">
              <span className="text-muted-foreground">{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </Panel>
      </div>

      {/* operations AI question advisory */}
      <QuestionPanel />

      {/* AI agents communication */}
      <div id="agent-comms-section" className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <section className="flex h-[560px] flex-col rounded-sm border bg-card/60 xl:col-span-2">
          <header className="flex items-center justify-between border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em]">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
              <span>AGENT COMMS — 5 AI AGENTS · SYNCHRONIZED OPERATIONS</span>
            </span>
            <div className="flex items-center gap-3">
              <div className="hidden gap-2 md:flex">
                {AGENT_LIST.map((id) => (
                  <span key={id} className={`text-[10px] ${AGENT_COLORS[id]}`}>
                    ● {id}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setPaused((p) => !p)}
                className="rounded-sm border px-2 py-1 text-[10px] hover:bg-muted"
              >
                {paused ? "▶ RESUME" : "❚❚ PAUSE"}
              </button>
            </div>
          </header>

          {/* Active Marked Event Response Banner & 5 AI Work Matrix */}
          {markedEvent ? (
            <div className="border-b bg-destructive/10 px-4 py-3 font-mono">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-sm shadow-md ring-2 ring-destructive/40 animate-pulse">
                    {markedEvent.icon}
                  </span>
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                      <span>RESPONDING TO: {markedEvent.title.toUpperCase()}</span>
                      <span className="rounded bg-destructive/20 px-1.5 py-0.2 text-[9px] font-extrabold uppercase text-destructive border border-destructive/40">
                        {markedEvent.severity}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Location: <b className="text-foreground">{markedEvent.locationName}</b> (
                      {markedEvent.lat.toFixed(4)}, {markedEvent.lng.toFixed(4)}) · Radius:{" "}
                      {markedEvent.radiusM}m
                    </div>
                  </div>
                </div>

                {onClearEvent && (
                  <button
                    onClick={onClearEvent}
                    className="rounded border border-destructive/60 bg-background/80 px-2 py-1 text-[10px] text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                  >
                    CLEAR EVENT ✕
                  </button>
                )}
              </div>

              {/* 5 AI Synchronized Working Status Matrix */}
              <div className="mt-3">
                <div className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase mb-1 flex items-center justify-between">
                  <span>⚡ 5 AI AGENTS AT WORK — REAL-TIME TASKS</span>
                  <span className="text-accent animate-pulse">COLLABORATION ACTIVE</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-5 text-[10px]">
                  <div className="rounded-sm border border-accent/40 bg-background/70 p-2">
                    <div className="font-bold text-accent flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-ping" />
                      PREDICTION
                    </div>
                    <div className="mt-1 text-muted-foreground text-[10px] leading-tight">
                      {markedEvent.workStatus?.prediction ||
                        "Sensor analytics & CCTV stream verified"}
                    </div>
                  </div>
                  <div className="rounded-sm border border-primary/40 bg-background/70 p-2">
                    <div className="font-bold text-primary flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                      FORECAST
                    </div>
                    <div className="mt-1 text-muted-foreground text-[10px] leading-tight">
                      {markedEvent.workStatus?.forecast || "Containment perimeter modeled"}
                    </div>
                  </div>
                  <div className="rounded-sm border border-success/40 bg-background/70 p-2">
                    <div className="font-bold text-success flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success animate-ping" />
                      MOBILITY
                    </div>
                    <div className="mt-1 text-muted-foreground text-[10px] leading-tight">
                      {markedEvent.workStatus?.mobility || "Arterial detour cordon active"}
                    </div>
                  </div>
                  <div className="rounded-sm border border-destructive/40 bg-background/70 p-2">
                    <div className="font-bold text-destructive flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-ping" />
                      SAFETY
                    </div>
                    <div className="mt-1 text-muted-foreground text-[10px] leading-tight">
                      {markedEvent.workStatus?.safety || "Emergency units en route"}
                    </div>
                  </div>
                  <div className="rounded-sm border border-cyan-400/40 bg-background/70 p-2">
                    <div className="font-bold text-cyan-400 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
                      COMMS
                    </div>
                    <div className="mt-1 text-muted-foreground text-[10px] leading-tight">
                      {markedEvent.workStatus?.comms || "Public trilingual broadcast active"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-b bg-card/40 px-4 py-2 text-[11px] font-mono text-muted-foreground flex items-center justify-between">
              <span>
                STATUS: Routine urban monitoring. Click <b>"MARK EVENT"</b> on the map above to
                deploy all 5 AI agents to any Bangalore location.
              </span>
              <span className="rounded bg-success/20 text-success text-[10px] px-1.5 py-0.5 font-bold">
                ALL-CLEAR
              </span>
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto p-4 font-mono text-xs">
            {agentError && (
              <div className="rounded-sm border border-destructive/50 p-2 text-[10px] text-destructive">
                ⚠ API: {agentError}
              </div>
            )}
            {msgs.map((m, k) => {
              const right = AGENT_LIST.indexOf(m.from) % 2 === 1;
              // The first bubble after an incident is marked is the opening
              // report — highlight it red so the collision is unmissable.
              const isIncidentOpening = !!markedEvent && k === 0;
              return (
                <div key={k} className={`flex ${right ? "justify-end" : ""}`}>
                  <div
                    className={`max-w-[75%] rounded-sm border p-3 ${
                      isIncidentOpening
                        ? "border-destructive bg-destructive/10 text-destructive shadow-lg shadow-destructive/30"
                        : "bg-background/70"
                    }`}
                  >
                    {isIncidentOpening && (
                      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-destructive">
                        🚨 Incident opening report
                      </div>
                    )}
                    <div className="mb-1 flex gap-2 text-[10px]">
                      <span
                        className={isIncidentOpening ? "font-bold text-destructive" : color(m.from)}
                      >
                        {m.from}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span
                        className={isIncidentOpening ? "font-bold text-destructive" : color(m.to)}
                      >
                        {m.to}
                      </span>
                      <span className="ml-auto text-muted-foreground">{m.t}</span>
                    </div>
                    <div>{m.text}</div>
                  </div>
                </div>
              );
            })}
            {!paused && msgs.length === 0 && (
              <div className="text-muted-foreground">
                {markedEvent
                  ? `🚨 Incident thread opened — ${markedEvent.icon} ${markedEvent.typeName} at ${markedEvent.locationName}. All 5 agents responding…`
                  : "⟳ Connecting to NVIDIA NIM agents…"}
              </div>
            )}
            {!paused && msgs.length > 0 && (
              <div className="text-muted-foreground">
                {markedEvent
                  ? `… agents are responding to the ${markedEvent.typeName.toLowerCase()} at ${markedEvent.locationName}`
                  : "… agents are thinking"}
              </div>
            )}
            <div ref={chatEnd} />
          </div>
        </section>

        <section className="flex h-[560px] flex-col rounded-sm border border-accent/50 bg-card/60">
          <header className="border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em] text-accent">
            ◉ MONITOR AI — SUPERVISOR
          </header>
          <div className="grid grid-cols-3 gap-2 border-b p-3 font-mono text-[10px]">
            <div className="rounded-sm border p-2">
              <div className="text-muted-foreground">MESSAGES</div>
              <div className="text-lg font-bold">{msgs.length}</div>
            </div>
            <div className="rounded-sm border p-2">
              <div className="text-muted-foreground">FLAGS</div>
              <div className="text-lg font-bold text-primary">{warns}</div>
            </div>
            <div className="rounded-sm border p-2">
              <div className="text-muted-foreground">HEALTH</div>
              <div className="text-lg font-bold text-success">{Math.max(80, 100 - warns)}%</div>
            </div>
          </div>
          <div className="max-h-[55%] min-h-0 shrink-0 overflow-y-auto border-b p-3">
            {report ? (
              <article className="rounded-sm border border-accent/60 bg-accent/5 p-3">
                <div className="flex items-baseline justify-between text-[9px] font-bold uppercase tracking-[0.2em] text-accent">
                  <span>◈ Incident Report</span>
                  <span className="text-muted-foreground">{report.t}</span>
                </div>
                <h3 className="mt-2 text-[11px] leading-tight">{report.headline}</h3>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  {report.situation}
                </p>
                <ReportList
                  title="Authorised actions"
                  tone="text-success"
                  items={report.authorisedActions}
                />
                <ReportList
                  title="Unresolved risks"
                  tone="text-primary"
                  items={report.unresolvedRisks}
                />
                <div className="mt-2 border-t pt-2 text-[10px] leading-relaxed">
                  <span className="font-bold uppercase tracking-[0.2em] text-accent">
                    Supervisor:
                  </span>{" "}
                  {report.verdict}
                </div>
                {reportBusy && (
                  <div className="mt-1.5 text-[9px] tracking-widest text-muted-foreground">
                    ⟳ Supervisor revalidating the agent thread…
                  </div>
                )}
              </article>
            ) : reportBusy ? (
              <div className="text-[10px] leading-relaxed tracking-widest text-muted-foreground">
                ⟳ COMPILING INCIDENT REPORT — supervisor is validating the 5-agent consensus…
              </div>
            ) : (
              <div className="text-[10px] leading-relaxed tracking-widest text-muted-foreground">
                REPORT: ISSUED BY THE SUPERVISOR ONCE ALL 5 AGENTS HAVE REPLIED TO AN INCIDENT.
              </div>
            )}
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-3 font-mono text-[11px]">
            {logs.map((l, k) => (
              <div key={k} className="border-b pb-1">
                <span className="text-muted-foreground">{l.t}</span>{" "}
                <span
                  className={
                    l.level === "WARN"
                      ? "text-primary"
                      : l.level === "OK"
                        ? "text-success"
                        : "text-accent"
                  }
                >
                  [{l.level}]
                </span>{" "}
                {l.text}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
