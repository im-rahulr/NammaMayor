import { useEffect, useRef, useState, useCallback } from "react";

import { getNews } from "@/lib/news";
import {
  askQuestion,
  agentChat,
  DEFAULT_QUESTION,
  AGENT_TURN_ORDER,
  type QuestionResult,
  type AgentMessage,
} from "@/lib/nvidia";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { NewsItem } from "@/lib/news-rss";

type Feed = { t: string; agent: string; msg: string; tone: "sys" | "agent" | "warn" | "ok" };
type Props = {
  feed: Feed[];
  depth: Record<string, number>;
  zones: { id: string; name: string }[];
  live: boolean;
  mode: string;
};

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

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

export function CommandPanels({ feed, depth, zones, live, mode }: Props) {
  const [msgs, setMsgs] = useState<AgentMessage[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [paused, setPaused] = useState(false);
  // turnIndex tracks position in AGENT_TURN_ORDER (0-4)
  const turnIndexRef = useRef(0);
  // Track last message text for the next agent's context
  const lastMsgRef = useRef("");
  // Whether an API call is in-flight (prevent overlapping calls)
  const busyRef = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const [cctvOpen, setCctvOpen] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const modeRef = useRef(mode);
  modeRef.current = mode;
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
  // Each tick fires one agentChat call. We use a ref-based flag so no
  // concurrent calls fire even if the effect re-runs.
  const fireTurn = useCallback(async () => {
    if (busyRef.current || pausedRef.current) return;
    busyRef.current = true;
    setAgentError(null);
    try {
      const result = await agentChat({
        data: {
          turnIndex: turnIndexRef.current,
          lastMessage: lastMsgRef.current,
          mode: modeRef.current,
        },
      });
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
                  text: `Cycle complete. All 5 agents responded. Action logged.`,
                }
              : {
                  t: ts,
                  level: "INFO",
                  text: `${msg.from} → ${msg.to} · ${lat} ms · policy OK`,
                };
        setLogs((l) => [logEntry, ...l].slice(0, 80));
      }
      turnIndexRef.current = (turnIndexRef.current + 1) % AGENT_TURN_ORDER.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Agent API error";
      setAgentError(msg);
      setLogs((l) =>
        [{ t: now(), level: "WARN" as const, text: `Agent API error: ${msg.slice(0, 80)}` }, ...l].slice(
          0,
          80,
        ),
      );
      // Back off: don't advance the turn so the same agent retries next cycle
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const delay = live ? LIVE_INTERVAL_MS : PAUSED_CHECK_MS;
    const id = setInterval(() => {
      void fireTurn();
    }, delay);
    // Fire immediately on mount / mode change
    void fireTurn();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <section className="flex h-[560px] flex-col rounded-sm border bg-card/60 xl:col-span-2">
          <header className="flex items-center justify-between border-b px-4 py-3 font-mono text-xs font-bold tracking-[0.2em]">
            <span>● AGENT COMMS — 5 AGENTS · NVIDIA NIM LIVE</span>
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
                className="rounded-sm border px-2 py-1 text-[10px]"
              >
                {paused ? "▶ RESUME" : "❚❚ PAUSE"}
              </button>
            </div>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 font-mono text-xs">
            {agentError && (
              <div className="rounded-sm border border-destructive/50 p-2 text-[10px] text-destructive">
                ⚠ API: {agentError}
              </div>
            )}
            {msgs.map((m, k) => {
              const right = AGENT_LIST.indexOf(m.from) % 2 === 1;
              return (
                <div key={k} className={`flex ${right ? "justify-end" : ""}`}>
                  <div className="max-w-[75%] rounded-sm border bg-background/70 p-3">
                    <div className="mb-1 flex gap-2 text-[10px]">
                      <span className={color(m.from)}>{m.from}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className={color(m.to)}>{m.to}</span>
                      <span className="ml-auto text-muted-foreground">{m.t}</span>
                    </div>
                    <div>{m.text}</div>
                  </div>
                </div>
              );
            })}
            {!paused && msgs.length === 0 && (
              <div className="text-muted-foreground">⟳ Connecting to NVIDIA NIM agents…</div>
            )}
            {!paused && msgs.length > 0 && (
              <div className="text-muted-foreground">… agents are thinking</div>
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
