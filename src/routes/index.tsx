import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NammaMayor — Agentic urban operations platform" },
      {
        name: "description",
        content:
          "Seven coordinated AI agents that detect, predict and respond to crowd crises in real time.",
      },
      { property: "og:title", content: "NammaMayor — Agentic urban operations platform" },
      {
        property: "og:description",
        content:
          "Seven coordinated AI agents that detect, predict and respond to crowd crises in real time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const AGENTS = [
  {
    e: "👁️",
    name: "Perception",
    role: "Real-time crowd density monitoring, camera anomaly detection",
    model: "Mistral-Nemo-Instruct-2407",
    log: "Gate C density 6.8 p/m² — anomaly flagged on CAM-14",
  },
  {
    e: "🔮",
    name: "Forecast",
    role: "Predictive crush trajectory modeling, risk scoring",
    model: "DeepSeek-V3.2",
    log: "Crush risk 0.82 within 7 min if inflow sustained",
  },
  {
    e: "🚦",
    name: "Mobility",
    role: "Evacuation corridor planning, route optimization",
    model: "Qwen2.5-7B-Instruct",
    log: "Corridor B→North Plaza opened, est. clearance 11 min",
  },
  {
    e: "🚌",
    name: "Transit",
    role: "Bus and transport fleet coordination",
    model: "Qwen2.5-7B-Instruct",
    log: "12 shuttles rerouted to Stop 4; metro M2 entry throttled",
  },
  {
    e: "🛡️",
    name: "Safety",
    role: "Medical team dispatch, ambulance routing",
    model: "Mistral-Nemo-Instruct-2407",
    log: "Med team 3 staged at Gate C; ambulance lane cleared",
  },
  {
    e: "📢",
    name: "Communications",
    role: "Multilingual public alerts, stadium broadcast",
    model: "Mistral-Nemo-Instruct-2407",
    log: "Broadcast queued — EN / FR / HI / KN",
  },
  {
    e: "🧠",
    name: "Orchestrator",
    role: "Command authority — synthesizes inputs, issues binding decisions",
    model: "DeepSeek-V3.1",
    log: "AUTHORIZED: Plan Delta-2. Execute all actions.",
  },
];

const STAGES = ["Detection", "Forecast", "Deliberation", "Authorization", "Execution"];

const PROBLEMS = [
  ["Fragmented monitoring", "No single operator sees the full picture."],
  ["Reactive coordination", "Response arrives minutes after critical thresholds breach."],
  ["Communication bottlenecks", "Transport, security, medical and comms operate in silos."],
  ["Dashboard paralysis", "Operators see data but receive no synthesis or decision support."],
  ["Cascade failure", "One blocked gate → metro overcrowding → ambulance gridlock."],
];

const USES = [
  "🏙️ Smart city management",
  "🚨 Crisis management",
  "⚡ Energy optimization",
  "🚦 Traffic & mobility",
  "🌊 Disaster response",
  "🏥 Public health emergencies",
  "🎭 Concerts, summits, festivals",
];

const LAYERS = [
  ["Dashboard", "Streamlit + CesiumJS 3D digital twin"],
  ["Backend", "FastAPI — scenario state, agent runs, WebSocket"],
  ["Agents", "CrewAI — 6 specialists + Orchestrator"],
  ["Simulation", "SUMO-style frames — baseline / intervention"],
];

function Index() {
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    if (step >= AGENTS.length - 1) {
      setRunning(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [running, step]);

  const start = () => {
    setStep(-1);
    setRunning(true);
  };
  const stage = step < 0 ? -1 : step === 0 ? 0 : step === 1 ? 1 : step < 6 ? 2 : running ? 3 : 4;
  const done = !running && step === AGENTS.length - 1;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span className="text-foreground">
          <span className="text-primary">■</span> NAMMAMAYOR
        </span>
        <span className="flex items-center gap-4">
          <Link to="/routes" className="transition-colors hover:text-accent">
            ROUTE ENGINE
          </Link>
          <Link to="/events" className="transition-colors hover:text-accent">
            EVENT IMPACT PLANNER
          </Link>
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="pulse-ring absolute inset-0 rounded-full bg-success" />
              <span className="relative h-2 w-2 rounded-full bg-success" />
            </span>
            SYSTEMS NOMINAL
          </span>
        </span>
      </nav>

      <section className="py-24">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          Agentic urban operations
        </p>
        <h1 className="mt-6 max-w-4xl text-5xl font-bold leading-[1.05] md:text-7xl">
          The information existed. <span className="text-primary">The intelligence did not.</span>
        </h1>
        <p className="mt-8 max-w-2xl text-lg text-muted-foreground">
          NammaMayor deploys a coordinated team of specialized AI agents that detect, predict and
          respond to crowd crises in real time — turning fragmented sensor data into decisions,
          evacuation corridors and public broadcasts.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            to="/command"
            className="rounded-sm bg-primary px-6 py-3 font-mono text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            OPEN COMMAND CENTER →
          </Link>
          <Link
            to="/events"
            className="rounded-sm border border-accent/50 px-6 py-3 font-mono text-sm text-accent hover:bg-accent/10"
          >
            EVENT IMPACT PLANNER →
          </Link>
          <a
            href="#agents"
            className="rounded-sm border px-6 py-3 font-mono text-sm hover:bg-secondary"
          >
            MEET THE AGENTS
          </a>
        </div>
      </section>

      <section className="border-t py-20">
        <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-destructive">
          // The problem
        </h2>
        <div className="mt-8 grid gap-px overflow-hidden rounded-sm border bg-border md:grid-cols-5">
          {PROBLEMS.map(([t, d], i) => (
            <div key={t} className="bg-card p-5">
              <div className="font-mono text-xs text-muted-foreground">0{i + 1}</div>
              <div className="mt-3 font-semibold">{t}</div>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="simulation" className="border-t py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
              // Live scenario — Olympic stadium, Gate C
            </h2>
            <p className="mt-3 max-w-xl text-muted-foreground">
              Causal pacing: each agent acts only on what came before it. The Orchestrator holds
              veto authority.
            </p>
          </div>
          <button
            onClick={start}
            disabled={running}
            className="rounded-sm bg-destructive px-5 py-3 font-mono text-sm font-semibold text-destructive-foreground disabled:opacity-50"
          >
            {running ? "RESPONDING…" : done ? "↻ REPLAY INCIDENT" : "⚠ TRIGGER INCIDENT"}
          </button>
        </div>

        <div className="mt-8 flex flex-wrap gap-2 font-mono text-xs">
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={`rounded-sm border px-3 py-1.5 ${i <= stage ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {s}
            </span>
          ))}
        </div>

        <div className="relative mt-6 overflow-hidden rounded-sm border bg-card p-5 font-mono text-sm">
          <div className="scanline pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-transparent via-accent/5 to-transparent" />
          {step < 0 && (
            <p className="text-muted-foreground">
              &gt; Awaiting events. Trigger an incident to watch the crew respond.
            </p>
          )}
          {AGENTS.slice(0, step + 1).map((a, i) => (
            <div key={a.name} className="animate-in fade-in slide-in-from-left-2 flex gap-3 py-1.5">
              <span className="text-muted-foreground">T+{String(i * 12).padStart(3, "0")}s</span>
              <span className={a.name === "Orchestrator" ? "text-primary" : "text-accent"}>
                [{a.name.toUpperCase()}]
              </span>
              <span>{a.log}</span>
            </div>
          ))}
          {done && (
            <p className="mt-3 text-success">&gt; Incident contained. Projected crush averted.</p>
          )}
        </div>
      </section>

      <section id="agents" className="border-t py-20">
        <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
          // The seven agents
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((a, i) => (
            <div
              key={a.name}
              className={`rounded-sm border bg-card p-6 transition-colors ${i <= step ? "border-primary" : ""} ${a.name === "Orchestrator" ? "lg:col-span-3" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-3xl">{a.e}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{a.model}</span>
              </div>
              <h3 className="mt-4 text-xl font-semibold">{a.name}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{a.role}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-12 border-t py-20 md:grid-cols-2">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-primary">
            // Beyond the Olympics
          </h2>
          <p className="mt-4 text-2xl font-semibold">
            The Olympics is the stress test, not the product.
          </p>
          <ul className="mt-6 space-y-3">
            {USES.map((u) => (
              <li key={u} className="border-b pb-3">
                {u}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
            // Architecture
          </h2>
          <div className="mt-6 space-y-2">
            {LAYERS.map(([n, d]) => (
              <div key={n} className="rounded-sm border bg-card p-4 font-mono text-sm">
                <div className="text-primary">{n}</div>
                <div className="mt-1 text-muted-foreground">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t py-8 font-mono text-xs text-muted-foreground">
        NammaMayor · Built to scale to any urban challenge.
      </footer>
    </main>
  );
}
