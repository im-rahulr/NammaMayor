import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { CommandPanels } from "@/components/CommandPanels";
import {
  computeImpact,
  computeDynamicRoadImpact,
  DIVERSIONS as DIVERSION_PLAN,
  VEHICLE_CLASSES,
} from "@/lib/traffic-model";
import {
  NODES,
  ALL_EDGES,
  EDGES,
  getEdgeCoords,
  findNearestEdge,
  getNode,
  getFullRoadLabel,
  CITY_LOCATIONS,
  findNearestLocation,
  type Edge,
  type CityLocation,
} from "@/lib/road-graph";
import { shortestPath, kAlternatives, type PathResult } from "@/lib/dijkstra";
import {
  loadRoads,
  loadHealthCentres,
  nearestRoad,
  hierarchyMeta,
  widthClass,
  WIDTH_CLASSES,
  formatKm,
  type RoadData,
  type HealthData,
  type RoadSegment,
} from "@/lib/city-data";

export const Route = createFileRoute("/command")({
  head: () => ({
    meta: [
      { title: "NammaMayor OS — Live command center" },
      {
        name: "description",
        content:
          "Live crisis map of Bangalore with AI agent feed, road closures, detours, flood and gas-leak simulations, zone severity and dispatches.",
      },
      { property: "og:title", content: "NammaMayor OS — Live command center" },
      {
        property: "og:description",
        content:
          "Live crisis map with AI agent feed, road closures, simulations, zone severity and dispatches.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Command,
});

type Kind = "hospital" | "police" | "shelter";
type Zone = { id: string; name: string; lat: number; lng: number; sens: number };
type Res = { id: string; kind: Kind; name: string; lat: number; lng: number };
type Feed = { t: string; agent: string; msg: string; tone: "sys" | "agent" | "warn" | "ok" };
type Dispatch = { id: string; res: Res; zone: Zone; status: "EN ROUTE" | "ON SCENE"; eta: number };
type Mode = "idle" | "storm" | "gas" | "road";

export type EventTypeItem = {
  type: "flood" | "gas" | "accident" | "roadblock" | "fire" | "medical";
  name: string;
  icon: string;
  severity: "CRITICAL" | "HIGH" | "ELEVATED";
  radius: number;
  desc: string;
};

export type MarkedEvent = {
  id: string;
  type: "flood" | "gas" | "accident" | "roadblock" | "fire" | "medical";
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
  workStatus: {
    prediction: string;
    forecast: string;
    mobility: string;
    safety: string;
    comms: string;
  };
};

export const EVENT_TYPES: EventTypeItem[] = [
  {
    type: "flood",
    name: "Flood / Inundation",
    icon: "🌊",
    severity: "CRITICAL",
    radius: 400,
    desc: "Severe stormwater drain overflow, road flooding, and stalled vehicles.",
  },
  {
    type: "gas",
    name: "Gas Leak / Hazmat",
    icon: "🔥",
    severity: "CRITICAL",
    radius: 500,
    desc: "Toxic chemical / methane vapor cloud with active wind dispersal.",
  },
  {
    type: "accident",
    name: "Major Collision",
    icon: "💥",
    severity: "HIGH",
    radius: 250,
    desc: "Multi-vehicle pileup causing full carriageway blockage and debris.",
  },
  {
    type: "roadblock",
    name: "Road Cave-in / Block",
    icon: "🚧",
    severity: "HIGH",
    radius: 300,
    desc: "Subsidence and sinkhole formation, thoroughfare closed to transit.",
  },
  {
    type: "fire",
    name: "Fire / Industrial Hazard",
    icon: "⚠️",
    severity: "CRITICAL",
    radius: 450,
    desc: "Rapid flame escalation with heavy particulate dispersion across wards.",
  },
  {
    type: "medical",
    name: "Mass Casualty / Medical",
    icon: "🏥",
    severity: "CRITICAL",
    radius: 350,
    desc: "Emergency medical surge requiring on-scene triage and ambulance convoys.",
  },
];

export const PRESET_EVENTS = [
  {
    id: "silkboard-flood",
    type: "flood" as const,
    name: "Flood / Inundation",
    icon: "🌊",
    title: "Silk Board Flash Flood",
    locationName: "Silk Board Junction",
    lat: 12.9177,
    lng: 77.6238,
    radius: 400,
    severity: "CRITICAL" as const,
    desc: "ORR underpass submerged with 0.65m water; drain capacity exceeded.",
  },
  {
    id: "hsr-gas",
    type: "gas" as const,
    name: "Gas Leak / Hazmat",
    icon: "🔥",
    title: "HSR Sector 2 Methane Leak",
    locationName: "HSR Layout Sector 2",
    lat: 12.9116,
    lng: 77.6474,
    radius: 500,
    severity: "CRITICAL" as const,
    desc: "Pipeline breach detected; vapor drifting toward residential clusters.",
  },
  {
    id: "indiranagar-crash",
    type: "accident" as const,
    name: "Major Collision",
    icon: "💥",
    title: "100ft Indiranagar Pileup",
    locationName: "Indiranagar 100ft Road",
    lat: 12.9719,
    lng: 77.6412,
    radius: 300,
    severity: "HIGH" as const,
    desc: "Bus and multi-car collision halting arterial commercial corridor.",
  },
  {
    id: "bellandur-block",
    type: "roadblock" as const,
    name: "Road Cave-in / Block",
    icon: "🚧",
    title: "Bellandur Flyover Cave-in",
    locationName: "Bellandur Outer Ring Road",
    lat: 12.926,
    lng: 77.6762,
    radius: 350,
    severity: "HIGH" as const,
    desc: "Carriageway collapse near tech parks requiring peripheral detours.",
  },
];

export type LocPoint = { id: string; name: string; lat: number; lng: number; isCustom?: boolean };

export type RouteOption = {
  id: string;
  label: string;
  coords: [number, number][];
  distanceKm: number;
  durationMin: number;
  via: string;
};

const ZONES: Zone[] = [
  { id: "SILKBOARD", name: "Silk Board Junction", lat: 12.9177, lng: 77.6238, sens: 1.5 },
  { id: "KORAMANGALA", name: "Koramangala", lat: 12.9352, lng: 77.6245, sens: 1.1 },
  { id: "SARJAPUR", name: "Sarjapur Road", lat: 12.9105, lng: 77.673, sens: 0.95 },
  { id: "BELLANDUR", name: "Bellandur", lat: 12.926, lng: 77.6762, sens: 0.85 },
  { id: "HSR", name: "HSR Layout", lat: 12.9116, lng: 77.6474, sens: 0.8 },
  { id: "BTM", name: "BTM Layout", lat: 12.9166, lng: 77.6101, sens: 0.6 },
];

const RES: Res[] = [
  { id: "H1", kind: "hospital", name: "St. John's Hospital", lat: 12.9298, lng: 77.6195 },
  { id: "H2", kind: "hospital", name: "Koramangala Clinic", lat: 12.9381, lng: 77.6301 },
  { id: "H3", kind: "hospital", name: "Sakra Hospital", lat: 12.9277, lng: 77.6814 },
  { id: "H4", kind: "hospital", name: "Narayana HSR", lat: 12.9081, lng: 77.6399 },
  { id: "H5", kind: "hospital", name: "BTM Care", lat: 12.9122, lng: 77.6062 },
  { id: "P1", kind: "police", name: "Koramangala PS", lat: 12.9448, lng: 77.6224 },
  { id: "P2", kind: "police", name: "Madiwala PS", lat: 12.9225, lng: 77.6155 },
  { id: "P3", kind: "police", name: "HSR PS", lat: 12.9142, lng: 77.6529 },
  { id: "P4", kind: "police", name: "Bellandur PS", lat: 12.9235, lng: 77.6792 },
  { id: "S1", kind: "shelter", name: "Agara Relief Camp", lat: 12.9235, lng: 77.6431 },
  { id: "S2", kind: "shelter", name: "HSR Community Hall", lat: 12.9072, lng: 77.6455 },
  { id: "S3", kind: "shelter", name: "Ibblur School", lat: 12.9205, lng: 77.6612 },
];

const GLYPH: Record<Kind, string> = { hospital: "+", police: "⛨", shelter: "⌂" };
const KIND_CLASS: Record<Kind, string> = {
  hospital: "bg-destructive",
  police: "bg-accent",
  shelter: "bg-success",
};

const SCRIPT: Record<
  Exclude<Mode, "idle" | "road">,
  Record<number, [string, string, Feed["tone"]]>
> = {
  storm: {
    1: ["prediction", "Rainfall 48 mm/h detected over Silk Board catchment", "agent"],
    4: ["FORECAST", "Flood depth at Silk Board projected 0.9 m within 20 min", "warn"],
    7: ["MOBILITY", "ORR eastbound closed; diverting via Hosur Rd flyover", "agent"],
    10: ["TRANSIT", "8 BMTC buses re-routed to Agara Relief Camp", "agent"],
    13: ["SAFETY", "Ambulances staged at St. John's & Narayana HSR", "agent"],
    16: ["COMMS", "SMS alert sent EN / KN / HI — 42,300 recipients", "agent"],
    19: ["ORCHESTRATOR", "AUTHORIZED: Plan Monsoon-3. Execute evacuation.", "ok"],
    30: ["SYS", "Water receding. Zones stabilising.", "ok"],
  },
  gas: {
    1: ["prediction", "Methane sensor spike near HSR Sector 2 — 4.1% LEL", "warn"],
    4: ["FORECAST", "Plume drifting NE at 3 m/s toward Agara", "warn"],
    7: ["MOBILITY", "500 m cordon set; 27th Main closed", "agent"],
    10: ["SAFETY", "Fire tender + 2 ambulances dispatched", "agent"],
    13: ["COMMS", "Shelter-in-place broadcast to HSR & Agara", "agent"],
    16: ["ORCHESTRATOR", "AUTHORIZED: Plan Vapor-1. Isolate GAIL valve 14.", "ok"],
    26: ["SYS", "Leak isolated. LEL back below 0.5%.", "ok"],
  },
};

const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot(a.lat - b.lat, a.lng - b.lng);
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const HEALTH_ZONE_COLORS = [
  "#22d3ee",
  "#4ade80",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#f87171",
  "#38bdf8",
  "#fb923c",
  "#34d399",
];

function distToSeg(
  p: { lat: number; lng: number },
  a: [number, number],
  b: [number, number],
): number {
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111320;
  const ky = 110540;
  const ax = (a[1] - p.lng) * kx,
    ay = (a[0] - p.lat) * ky;
  const bx = (b[1] - p.lng) * kx,
    by = (b[0] - p.lat) * ky;
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx,
    py = ay + t * dy;
  return Math.hypot(px, py);
}

function minDistanceToRoute(p: { lat: number; lng: number }, coords: [number, number][]): number {
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distToSeg(p, coords[i]!, coords[i + 1]!);
    if (d < min) min = d;
  }
  return min;
}

function Command() {
  const mapEl = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const circles = useRef<Record<string, Leaflet.Circle>>({});
  const lines = useRef<Leaflet.LayerGroup | null>(null);
  const corridorLayer = useRef<Leaflet.LayerGroup | null>(null);
  const closureLayer = useRef<Leaflet.LayerGroup | null>(null);
  const eventLayer = useRef<Leaflet.LayerGroup | null>(null);
  const hazard = useRef<Leaflet.Circle | null>(null);
  const roadLayer = useRef<Leaflet.LayerGroup | null>(null);
  const healthLayer = useRef<Leaflet.LayerGroup | null>(null);
  const roadRenderer = useRef<Leaflet.Canvas | null>(null);
  const pickedLayer = useRef<Leaflet.Polyline | null>(null);

  const [clock, setClock] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [stage, setStage] = useState<1 | 2>(1);
  const [radio, setRadio] = useState<"none" | "pending" | "handled">("none");
  const [tick, setTick] = useState(0);
  const [depth, setDepth] = useState<Record<string, number>>(() =>
    Object.fromEntries(ZONES.map((z) => [z.id, 0.05 * z.sens])),
  );
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const radioRef = useRef(radio);
  radioRef.current = radio;
  const [feed, setFeed] = useState<Feed[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [tab, setTab] = useState<"Overview" | "Reports" | "Resources" | "Triage">("Overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [compute, setCompute] = useState<number | null>(null);
  const [showKinds, setShowKinds] = useState<Record<Kind, boolean>>({
    hospital: true,
    police: true,
    shelter: true,
  });

  // Marked map event state for the 5 AI agents to chat and work
  const [markedEvent, setMarkedEvent] = useState<MarkedEvent | null>(null);
  const [eventMarkMode, setEventMarkMode] = useState(false);
  const [selectedEventType, setSelectedEventType] = useState<EventTypeItem>(EVENT_TYPES[0]!);
  const eventMarkModeRef = useRef(eventMarkMode);
  eventMarkModeRef.current = eventMarkMode;
  const selectedEventTypeRef = useRef(selectedEventType);
  selectedEventTypeRef.current = selectedEventType;
  const markedEventRef = useRef(markedEvent);
  markedEventRef.current = markedEvent;

  // Free Location & Road Closure State
  const [origin, setOrigin] = useState<LocPoint>({
    id: "SILK",
    name: "Silk Board Junction",
    lat: 12.9177,
    lng: 77.6238,
  });

  const [destination, setDestination] = useState<LocPoint>({
    id: "BELL",
    name: "Bellandur (EcoSpace)",
    lat: 12.926,
    lng: 77.6762,
  });

  const [closurePoint, setClosurePoint] = useState<LocPoint | null>({
    id: "AGARA",
    name: "Agara Junction / ORR",
    lat: 12.9235,
    lng: 77.6431,
  });

  const [mapPickMode, setMapPickMode] = useState<"none" | "origin" | "destination" | "closure">(
    "none",
  );
  const mapPickModeRef = useRef(mapPickMode);
  mapPickModeRef.current = mapPickMode;

  const [locationSearch, setLocationSearch] = useState("");
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [baselineRoute, setBaselineRoute] = useState<RouteOption | null>(null);
  const [activeAltIndex, setActiveAltIndex] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);

  const modeRef = useRef<Mode>("idle");
  modeRef.current = mode;
  const markers = useRef<Record<string, Leaflet.Marker>>({});

  // Real BBMP layers (static JSON built from the KML exports in datas/)
  const [roads, setRoads] = useState<RoadData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [showRoads, setShowRoads] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [roadPalette, setRoadPalette] = useState<"hierarchy" | "width">("hierarchy");
  const [hiddenHierarchies, setHiddenHierarchies] = useState<Set<string>>(new Set());
  const [pickedRoad, setPickedRoad] = useState<{ road: RoadSegment; distanceM: number } | null>(
    null,
  );
  const [dataError, setDataError] = useState<string | null>(null);
  const roadsRef = useRef<RoadData | null>(null);
  roadsRef.current = roads;
  const showRoadsRef = useRef(false);
  showRoadsRef.current = showRoads;

  const push = useCallback((agent: string, msg: string, tone: Feed["tone"]) => {
    setFeed((f) => [{ t: now(), agent, msg, tone }, ...f].slice(0, 50));
  }, []);

  const handleMarkEvent = useCallback(
    (lat: number, lng: number, evType: EventTypeItem = selectedEventTypeRef.current) => {
      const near = findNearestLocation(lat, lng);
      const distM = Math.round(Math.hypot(near.lat - lat, near.lng - lng) * 111000);
      const locName = distM < 400 ? near.name : `${near.name} Area (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      const title = `${evType.name} at ${near.name}`;

      const workStatus = {
        prediction: `Sensor node #BLR-${Math.abs(Math.round(lat * 1000)) % 900 + 100} at ${near.name} confirms ${evType.name} anomaly (Confidence: 97%). CCTV feed active.`,
        forecast: `Simulation models ${evType.radius}m containment envelope around ${near.name}. Projected containment: 30 min. Risk level: ${evType.severity}.`,
        mobility: `Detour cordon placed on arterial roads to ${near.name}. Re-routing corridor traffic and BMTC fleet via parallel arterial.`,
        safety: `Dispatched 2 EMS ambulances and 1 rapid rescue patrol to ${near.name}. Staging ETA 5 minutes to perimeter.`,
        comms: `Emergency cell broadcast issued in Kannada and English to ${near.name} ward residents. Public advisories live.`,
      };

      const newEv: MarkedEvent = {
        id: `ev_${Date.now()}`,
        type: evType.type,
        typeName: evType.name,
        icon: evType.icon,
        title,
        locationName: locName,
        lat,
        lng,
        radiusM: evType.radius,
        severity: evType.severity,
        timestamp: now(),
        description: evType.desc,
        workStatus,
      };

      setMarkedEvent(newEv);
      setEventMarkMode(false);

      // Deploy emergency units into dispatches
      const sortedRes = [...RES].sort(
        (a, b) =>
          Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng),
      );
      const newDispatches: Dispatch[] = sortedRes.slice(0, 3).map((r, idx) => ({
        id: `disp_${Date.now()}_${idx}`,
        res: r,
        zone: { id: `z_${near.id}`, name: locName, lat, lng, sens: 1.2 },
        status: idx === 0 ? "ON SCENE" : "EN ROUTE",
        eta: idx === 0 ? 0 : Math.round(Math.hypot(r.lat - lat, r.lng - lng) * 111 * 2.8),
      }));
      setDispatches(newDispatches);

      // Push 5 AI operational feed updates
      push("SYS", `🚨 NEW MAP EVENT MARKED: ${evType.icon} ${title}. Engaging all 5 AI agents...`, "warn");
      push("PREDICTION", workStatus.prediction, "warn");
      push("FORECAST", workStatus.forecast, "agent");
      push("MOBILITY", workStatus.mobility, "agent");
      push("SAFETY", workStatus.safety, "warn");
      push("COMMS", workStatus.comms, "ok");

      map.current?.flyTo([lat, lng], 15, { duration: 1.2 });
    },
    [push],
  );

  const handleClearEvent = useCallback(() => {
    setMarkedEvent(null);
    setEventMarkMode(false);
    eventLayer.current?.clearLayers();
    setDispatches([]);
    push("SYS", "Map event cleared. 5 AI agents stand down and return to routine monitoring.", "ok");
  }, [push]);

  // clock + boot
  useEffect(() => {
    setClock(now());
    const i = setInterval(() => setClock(now()), 1000);
    push("SYS", "NammaMayorOS v2.0 — Crisis Intelligence Platform", "sys");
    push("SYS", "Bangalore — city operations area loaded", "sys");
    push("SYS", `${RES.length} resources · ${ZONES.length} zones online`, "sys");
    return () => clearInterval(i);
  }, [push]);

  // Grouped city locations by zone for intuitive dropdowns
  const locationsByZone = useMemo(() => {
    const zones: Record<string, CityLocation[]> = {};
    for (const loc of CITY_LOCATIONS) {
      if (!zones[loc.zone]) zones[loc.zone] = [];
      zones[loc.zone]!.push(loc);
    }
    return zones;
  }, []);

  // Filtered locations based on search
  const filteredLocationsByZone = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    const result: [string, CityLocation[]][] = [];
    for (const [zone, locs] of Object.entries(locationsByZone)) {
      const match = q
        ? locs.filter((l) => l.name.toLowerCase().includes(q) || zone.toLowerCase().includes(q))
        : locs;
      if (match.length) result.push([zone, match]);
    }
    return result;
  }, [locationsByZone, locationSearch]);

  // Dynamic route calculation with real OSRM engine + intelligent corridor routing
  useEffect(() => {
    if (mode !== "road") return;
    let cancelled = false;
    setIsCalculating(true);

    type OsrmRoute = {
      distance: number;
      duration: number;
      geometry: { coordinates: [number, number][] };
      legs?: { summary?: string }[];
    };

    const osrmFetch = async (
      coords: { lat: number; lng: number }[],
      alternatives = false,
    ): Promise<OsrmRoute[]> => {
      const coordStr = coords.map((c) => `${c.lng},${c.lat}`).join(";");
      const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson${alternatives ? "&alternatives=3" : ""}`;
      try {
        const res = await fetch(url).then((r) => r.json());
        return (res as { routes?: OsrmRoute[] }).routes ?? [];
      } catch {
        return [];
      }
    };

    const parseRoute = (
      rt: OsrmRoute,
      id: string,
      label: string,
      fallbackVia?: string,
    ): RouteOption => ({
      id,
      label,
      coords: rt.geometry.coordinates.map((c) => [c[1], c[0]]) as [number, number][],
      distanceKm: +(rt.distance / 1000).toFixed(1),
      durationMin: +(rt.duration / 60).toFixed(1),
      via: rt.legs?.[0]?.summary?.trim() || fallbackVia || "Arterial Corridor",
    });

    (async () => {
      try {
        // 1. Fetch real direct driving routes from OSRM with alternatives
        const directRoutes = await osrmFetch([origin, destination], true);
        if (cancelled) return;
        if (!directRoutes.length) throw new Error("No route found");

        const parsedDirect: RouteOption[] = directRoutes.map((rt, idx) =>
          parseRoute(rt, `direct_${idx}`, idx === 0 ? "Fastest Route" : `Alternative ${idx + 1}`),
        );

        const base = parsedDirect[0]!;
        setBaselineRoute(base);

        if (!closurePoint) {
          setRoutes(parsedDirect);
          setIsCalculating(false);
          return;
        }

        // 2. Road blockage check: 260m threshold strictly matches the hazard perimeter
        const isRouteBlocked = (coords: [number, number][]) =>
          minDistanceToRoute(closurePoint, coords) < 260;

        const baseIsBlocked = isRouteBlocked(base.coords);

        // Filter all direct routes: strictly eliminate any route that passes through the closure
        const cleanDirect = parsedDirect.filter((r) => !isRouteBlocked(r.coords));

        // If the direct route is NOT blocked, use only unblocked direct routes
        if (!baseIsBlocked && cleanDirect.length) {
          setRoutes(cleanDirect);
          setIsCalculating(false);
          return;
        }

        // 3. Primary route IS blocked: find real arterial detour routes avoiding the closure
        const unblockedAlts = cleanDirect;

        const originDist = (loc: CityLocation) =>
          Math.hypot(loc.lat - origin.lat, loc.lng - origin.lng);
        const destDist = (loc: CityLocation) =>
          Math.hypot(loc.lat - destination.lat, loc.lng - destination.lng);
        const directDist = Math.hypot(destination.lat - origin.lat, destination.lng - origin.lng);

        const candidateCorridors = CITY_LOCATIONS.filter((loc) => {
          if (loc.id === origin.id || loc.id === destination.id) return false;
          const distToClosureM =
            Math.hypot(loc.lat - closurePoint.lat, loc.lng - closurePoint.lng) * 111000;
          if (distToClosureM < 450) return false; // Must be well clear of the closure
          const ratio = (originDist(loc) + destDist(loc)) / (directDist || 0.01);
          return ratio < 1.85;
        })
          .sort((a, b) => {
            const ratioA = (originDist(a) + destDist(a)) / (directDist || 0.01);
            const ratioB = (originDist(b) + destDist(b)) / (directDist || 0.01);
            return ratioA - ratioB;
          })
          .slice(0, 8);

        const bypassPromises = candidateCorridors.map(async (loc, i) => {
          const rts = await osrmFetch([origin, loc, destination]);
          const rt = rts[0];
          if (!rt) return null;
          const shortName = (loc.name.split("(")[0] ?? loc.name).trim();
          const route = parseRoute(
            rt,
            `detour_${i}`,
            `Detour via ${shortName}`,
            `via ${shortName}`,
          );
          // Strictly reject if this route enters the 260m closure perimeter
          if (isRouteBlocked(route.coords)) return null;
          return route;
        });

        const bypassResults = (await Promise.all(bypassPromises)).filter(Boolean) as RouteOption[];
        if (cancelled) return;

        // Combine only routes that strictly avoid the closed segment
        const combined = [...unblockedAlts, ...bypassResults].filter(
          (r) => !isRouteBlocked(r.coords),
        );
        combined.sort((a, b) => a.durationMin - b.durationMin);

        const unique: RouteOption[] = [];
        for (const rt of combined) {
          if (
            !unique.some(
              (u) =>
                Math.abs(u.durationMin - rt.durationMin) < 0.8 &&
                Math.abs(u.distanceKm - rt.distanceKm) < 1.0,
            )
          ) {
            unique.push(rt);
          }
          if (unique.length >= 3) break;
        }

        setRoutes(unique.length ? unique : parsedDirect);
      } catch {
        if (cancelled) return;
        const dKm = +(
          Math.hypot(destination.lat - origin.lat, destination.lng - origin.lng) * 111
        ).toFixed(1);
        const fb: RouteOption = {
          id: "fb_1",
          label: "Direct Corridor",
          coords: [
            [origin.lat, origin.lng],
            [destination.lat, destination.lng],
          ],
          distanceKm: dKm,
          durationMin: +(dKm * 2.1).toFixed(1),
          via: "Direct City Connector",
        };
        setBaselineRoute(fb);
        setRoutes([fb]);
      } finally {
        if (!cancelled) setIsCalculating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, origin, destination, closurePoint]);

  // Selected route & traffic impact calculation
  const bestRoute = routes[activeAltIndex] ?? routes[0];
  const roadImpact = useMemo(() => {
    const baseMin = baselineRoute?.durationMin ?? 15.0;
    const detMin = bestRoute?.durationMin ?? baseMin;
    return computeDynamicRoadImpact(baseMin, detMin, closurePoint?.name ?? "Closed Road");
  }, [baselineRoute, bestRoute, closurePoint]);

  // Dynamic agent logging when origin, destination, or closure updates
  const handleSwapOriginDestination = useCallback(() => {
    setOrigin(destination);
    setDestination(origin);
    setActiveAltIndex(0);
    push(
      "MOBILITY",
      `Direction reversed: ${destination.name} → ${origin.name}. Recalculating routes...`,
      "agent",
    );
  }, [origin, destination, push]);

  // map init (browser only)
  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => {
      if (cancelled || !mapEl.current || map.current) return;
      const lf = (mod.default ?? mod) as typeof Leaflet;
      L.current = lf;
      const BOUND = lf.latLngBounds(lf.latLng(12.75, 77.38), lf.latLng(13.25, 77.88));
      const m = lf
        .map(mapEl.current, {
          zoomControl: false,
          attributionControl: true,
          maxBounds: BOUND,
          maxBoundsViscosity: 0.9,
          minZoom: 10,
          maxZoom: 19,
        })
        .setView([12.935, 77.635], 13);

      // OpenStreetMap standard tiles — free, no API key, dark look via CSS filter in styles.css
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · BBMP road width &amp; UPHC',
        maxZoom: 19,
        className: "dark-tiles",
      }).addTo(m);
      lf.control.zoom({ position: "bottomright" }).addTo(m);

      ZONES.forEach((z) => {
        circles.current[z.id] = lf
          .circle([z.lat, z.lng], { radius: 150, weight: 1, fillOpacity: 0.25 })
          .addTo(m)
          .bindTooltip(z.name)
          .on("click", () => setSelected(z.id));
      });

      RES.forEach((r) => {
        const icon = lf.divIcon({
          className: "",
          html: `<div class="${KIND_CLASS[r.kind]} flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground text-base font-bold text-background shadow-lg">${GLYPH[r.kind]}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        markers.current[r.id] = lf
          .marker([r.lat, r.lng], { icon })
          .addTo(m)
          .bindPopup(`<b>${r.name}</b><br/>${r.kind}`);
      });

      roadLayer.current = lf.layerGroup().addTo(m);
      healthLayer.current = lf.layerGroup().addTo(m);
      corridorLayer.current = lf.layerGroup().addTo(m);
      closureLayer.current = lf.layerGroup().addTo(m);
      eventLayer.current = lf.layerGroup().addTo(m);
      lines.current = lf.layerGroup().addTo(m);
      roadRenderer.current = lf.canvas({ padding: 0.3 });

      m.on("click", (e: Leaflet.LeafletMouseEvent) => {
        // Priority: If event marker mode is toggled, always mark event
        if (eventMarkModeRef.current) {
          handleMarkEvent(e.latlng.lat, e.latlng.lng, selectedEventTypeRef.current);
          return;
        }

        if (modeRef.current === "road") {
          const clickMode = mapPickModeRef.current;
          const pos = e.latlng;
          const near = findNearestLocation(pos.lat, pos.lng);
          const distM = Math.round(Math.hypot(near.lat - pos.lat, near.lng - pos.lng) * 111000);
          const locName =
            distM < 500
              ? near.name
              : `${near.name} Area (${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)})`;

          if (clickMode === "origin") {
            setOrigin({
              id: `c_${Date.now()}`,
              name: locName,
              lat: pos.lat,
              lng: pos.lng,
              isCustom: true,
            });
            setMapPickMode("none");
            push("MOBILITY", `Trip Origin set to: ${locName}. Recalculating routes...`, "agent");
            return;
          }
          if (clickMode === "destination") {
            setDestination({
              id: `c_${Date.now()}`,
              name: locName,
              lat: pos.lat,
              lng: pos.lng,
              isCustom: true,
            });
            setMapPickMode("none");
            push("MOBILITY", `Destination set to: ${locName}. Recalculating routes...`, "agent");
            return;
          }
          if (clickMode === "closure") {
            setClosurePoint({
              id: `c_${Date.now()}`,
              name: `${near.name} Road`,
              lat: pos.lat,
              lng: pos.lng,
              isCustom: true,
            });
            setMapPickMode("none");
            push(
              "MOBILITY",
              `🚨 Road closed at: ${near.name} Road. Computing alternate corridors...`,
              "warn",
            );
            return;
          }

          // Default click on map: toggle closure at this position!
          setClosurePoint((prev) => {
            if (prev && Math.hypot(prev.lat - pos.lat, prev.lng - pos.lng) * 111000 < 500) {
              push("MOBILITY", "Road closure cleared. Resuming open corridor.", "ok");
              return null;
            }
            push(
              "MOBILITY",
              `🚨 Road closed at: ${locName}. Computing alternate corridors...`,
              "warn",
            );
            return {
              id: `c_${Date.now()}`,
              name: `${near.name} Road`,
              lat: pos.lat,
              lng: pos.lng,
              isCustom: true,
            };
          });
          return;
        }

        // When in general monitoring/standby, clicking anywhere on the map marks an event!
        handleMarkEvent(e.latlng.lat, e.latlng.lng, selectedEventTypeRef.current);

        if (showRoadsRef.current && roadsRef.current) {
          setPickedRoad(nearestRoad(roadsRef.current.roads, e.latlng.lat, e.latlng.lng));
        }
      });

      map.current = m;
      paint(depth);
    });

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      lines.current = null;
      corridorLayer.current = null;
      closureLayer.current = null;
      eventLayer.current?.clearLayers();
      eventLayer.current = null;
      roadLayer.current = null;
      healthLayer.current = null;
      roadRenderer.current = null;
      pickedLayer.current = null;
      markers.current = {};
      circles.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [push, handleMarkEvent]);

  // Zone circle rendering (hidden completely in road mode to remove mock marks data)
  const paint = useCallback((d: Record<string, number>) => {
    const isRoad = modeRef.current === "road";
    const red = cssVar("--destructive"),
      amber = cssVar("--primary"),
      teal = cssVar("--accent");
    ZONES.forEach((z) => {
      const c = circles.current[z.id];
      if (!c) return;
      if (isRoad) {
        c.setStyle({ opacity: 0, fillOpacity: 0 });
      } else {
        const v = d[z.id] ?? 0;
        const col = v > 0.6 ? red : v > 0.3 ? amber : teal;
        c.setRadius(120 + Math.min(v, 1.2) * 450);
        c.setStyle({
          color: col,
          fillColor: col,
          fillOpacity: 0.15 + Math.min(v, 1) * 0.3,
          opacity: 1,
        });
      }
    });
  }, []);

  useEffect(() => paint(depth), [depth, mode, paint]);

  // Hide mock resource markers in road mode (user requested "remove all marks data")
  useEffect(() => {
    const isRoad = mode === "road";
    Object.entries(markers.current).forEach(([id, mk]) => {
      const r = RES.find((x) => x.id === id);
      const el = mk.getElement();
      if (el) {
        el.style.display = isRoad || !r || !showKinds[r.kind] ? "none" : "";
      }
    });
  }, [showKinds, mode]);

  // Render city routes, draggable origin & destination pins, and road closure barrier
  useEffect(() => {
    const lf = L.current,
      cl = closureLayer.current;
    if (!lf || !cl) return;

    cl.clearLayers();

    if (mode !== "road") return;

    // 1. Draw alternative routes (unselected ones first, behind)
    routes.forEach((rt, idx) => {
      if (idx === activeAltIndex) return;
      const col = "#64748b"; // muted slate gray for clean contrast
      const line = lf
        .polyline(rt.coords, {
          color: col,
          weight: 4,
          opacity: 0.6,
          dashArray: "5 5",
        })
        .addTo(cl)
        .bindTooltip(
          `Alt ${idx + 1} (${rt.via}) · ${rt.durationMin.toFixed(1)} min · ${rt.distanceKm.toFixed(1)} km`,
        );
      line.on("click", () => setActiveAltIndex(idx));
    });

    // 2. Draw active/selected route (Electric Blue navigation color — no green)
    const activeRoute = routes[activeAltIndex] ?? routes[0];
    let animationTimer: ReturnType<typeof setInterval> | null = null;
    if (activeRoute && activeRoute.coords.length > 1) {
      const isPrimary = activeAltIndex === 0;
      const col = "#2563eb"; // Electric Blue navigation color

      // Outer glow
      lf.polyline(activeRoute.coords, {
        color: "#3b82f6",
        weight: 12,
        opacity: 0.3,
        interactive: false,
      }).addTo(cl);

      // Base solid road line
      lf.polyline(activeRoute.coords, {
        color: col,
        weight: 6,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      })
        .addTo(cl)
        .bindTooltip(
          `${isPrimary ? (closurePoint ? "★ RECOMMENDED DETOUR" : "★ FASTEST ROUTE") : `ALT ${activeAltIndex + 1}`} · ${activeRoute.durationMin.toFixed(1)} min · ${activeRoute.distanceKm.toFixed(1)} km`,
          { sticky: true },
        );

      // Animated tracer flow line on top (Wolfram-style Dijkstra pulse flow)
      lf.polyline(activeRoute.coords, {
        color: "#93c5fd",
        weight: 3,
        opacity: 0.9,
        className: "route-flow-line",
        interactive: false,
      }).addTo(cl);

      // Moving path tracer robot/particle along the coordinates
      const tracerIcon = lf.divIcon({
        className: "",
        html: `<div class="relative flex h-5 w-5 items-center justify-center">
          <div class="absolute h-5 w-5 rounded-full bg-sky-400 tracer-beacon"></div>
          <div class="h-2.5 w-2.5 rounded-full bg-white shadow-md border border-sky-600"></div>
        </div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      const tracer = lf
        .marker(activeRoute.coords[0]!, { icon: tracerIcon, interactive: false })
        .addTo(cl);
      let step = 0;
      const totalSteps = activeRoute.coords.length;
      animationTimer = setInterval(() => {
        step = (step + 1) % totalSteps;
        const pt = activeRoute.coords[step];
        if (pt) {
          tracer.setLatLng(pt);
        }
      }, 140);
    }

    // 3. Draw Road Closure marker (if any)
    if (closurePoint) {
      const closureMarker = lf
        .marker([closurePoint.lat, closurePoint.lng], {
          draggable: true,
          icon: lf.divIcon({
            className: "",
            html: `<div class="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 border-2 border-white text-base font-bold text-white shadow-2xl ring-4 ring-red-500/40 animate-pulse cursor-grab active:cursor-grabbing">🚧</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
        })
        .addTo(cl);

      closureMarker.bindTooltip(
        `<b>🚧 CLOSED: ${closurePoint.name}</b><br/><span style="font-size:10px;color:#cbd5e1">Drag pin to move closure</span>`,
        { direction: "top" },
      );

      closureMarker.on("dragend", (e: Leaflet.LeafletEvent) => {
        const marker = e.target as Leaflet.Marker;
        const pos = marker.getLatLng();
        const near = findNearestLocation(pos.lat, pos.lng);
        setClosurePoint({
          id: `c_${Date.now()}`,
          name: `${near.name} Road`,
          lat: pos.lat,
          lng: pos.lng,
          isCustom: true,
        });
        push("MOBILITY", `Closure dragged to: ${near.name} Road. Recomputing routes...`, "warn");
      });

      // Red hazard circle around closure (matches 260m exclusion perimeter)
      lf.circle([closurePoint.lat, closurePoint.lng], {
        radius: 260,
        color: "#ef4444",
        fillColor: "#ef4444",
        fillOpacity: 0.18,
        weight: 2,
        dashArray: "4 4",
      }).addTo(cl);
    }

    // 4. Origin Marker (🏁 START — Slate Navy & White)
    const startMarker = lf
      .marker([origin.lat, origin.lng], {
        draggable: true,
        icon: lf.divIcon({
          className: "",
          html: `<div class="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 border-2 border-white text-base font-bold text-white shadow-2xl ring-4 ring-slate-500/40 cursor-grab active:cursor-grabbing">🏁</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      })
      .addTo(cl);

    startMarker.bindTooltip(
      `<b>🏁 START</b>: ${origin.name}<br/><span style="font-size:10px;color:#cbd5e1">Drag pin anywhere in Bangalore</span>`,
      { direction: "top" },
    );

    startMarker.on("dragend", (e: Leaflet.LeafletEvent) => {
      const marker = e.target as Leaflet.Marker;
      const pos = marker.getLatLng();
      const near = findNearestLocation(pos.lat, pos.lng);
      const distM = Math.round(Math.hypot(near.lat - pos.lat, near.lng - pos.lng) * 111000);
      setOrigin({
        id: `c_${Date.now()}`,
        name:
          distM < 600
            ? near.name
            : `Near ${near.name} (${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)})`,
        lat: pos.lat,
        lng: pos.lng,
        isCustom: true,
      });
      push("MOBILITY", `Origin dragged to: ${near.name}. Updating route...`, "agent");
    });

    // 5. Destination Marker (🎯 DESTINATION)
    const destMarker = lf
      .marker([destination.lat, destination.lng], {
        draggable: true,
        icon: lf.divIcon({
          className: "",
          html: `<div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 border-2 border-white text-base font-bold text-white shadow-2xl ring-4 ring-sky-500/30 cursor-grab active:cursor-grabbing">🎯</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      })
      .addTo(cl);

    destMarker.bindTooltip(
      `<b>🎯 DESTINATION</b>: ${destination.name}<br/><span style="font-size:10px;color:#cbd5e1">Drag pin anywhere in Bangalore</span>`,
      { direction: "top" },
    );

    destMarker.on("dragend", (e: Leaflet.LeafletEvent) => {
      const marker = e.target as Leaflet.Marker;
      const pos = marker.getLatLng();
      const near = findNearestLocation(pos.lat, pos.lng);
      const distM = Math.round(Math.hypot(near.lat - pos.lat, near.lng - pos.lng) * 111000);
      setDestination({
        id: `c_${Date.now()}`,
        name:
          distM < 600
            ? near.name
            : `Near ${near.name} (${pos.lat.toFixed(3)}, ${pos.lng.toFixed(3)})`,
        lat: pos.lat,
        lng: pos.lng,
        isCustom: true,
      });
      push("MOBILITY", `Destination dragged to: ${near.name}. Updating route...`, "agent");
    });

    return () => {
      if (animationTimer) clearInterval(animationTimer);
    };
  }, [mode, routes, activeAltIndex, origin, destination, closurePoint, push]);

  // Render Marked Event layer (Hazard perimeter, pulsating icon, Safety AI emergency dispatch lines, Mobility detour ring)
  useEffect(() => {
    const lf = L.current;
    const el = eventLayer.current;
    if (!lf || !el) return;

    el.clearLayers();

    if (!markedEvent) return;

    // 1. Animated marker for marked event
    const evIcon = lf.divIcon({
      className: "custom-event-pin",
      html: `
        <div class="relative flex items-center justify-center cursor-pointer">
          <span class="absolute h-14 w-14 rounded-full bg-red-500/40 animate-ping"></span>
          <span class="absolute h-10 w-10 rounded-full bg-red-600/60 animate-pulse"></span>
          <div class="relative flex h-9 w-9 items-center justify-center rounded-full bg-red-600 border-2 border-white text-base font-bold text-white shadow-2xl">
            ${markedEvent.icon}
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    const marker = lf
      .marker([markedEvent.lat, markedEvent.lng], {
        icon: evIcon,
        draggable: true,
      })
      .addTo(el);

    marker.bindTooltip(
      `<div style="font-family: monospace; font-size: 11px;">
        <b>${markedEvent.icon} ${markedEvent.title}</b><br/>
        <span style="color: #f87171; font-weight: bold;">SEVERITY: ${markedEvent.severity}</span><br/>
        <span style="color: #94a3b8; font-size: 10px;">Drag pin to move · 5 AI Agents Active</span>
      </div>`,
      { permanent: true, direction: "top", offset: [0, -18] },
    );

    marker.on("dragend", (e: Leaflet.LeafletEvent) => {
      const tgt = e.target as Leaflet.Marker;
      const pos = tgt.getLatLng();
      handleMarkEvent(pos.lat, pos.lng, selectedEventTypeRef.current);
    });

    // 2. Hazard Perimeter Circle (Prediction / Forecast AI)
    lf.circle([markedEvent.lat, markedEvent.lng], {
      radius: markedEvent.radiusM,
      color: "#ef4444",
      fillColor: "#ef4444",
      fillOpacity: 0.22,
      weight: 2,
      dashArray: "6 6",
    })
      .addTo(el)
      .bindTooltip(`FORECAST AI: Hazard perimeter ${markedEvent.radiusM}m around ${markedEvent.locationName}`);

    // 3. Mobility AI Detour Buffer / Cordon
    lf.circle([markedEvent.lat, markedEvent.lng], {
      radius: markedEvent.radiusM + 180,
      color: "#22c55e",
      fillColor: "#22c55e",
      fillOpacity: 0.06,
      weight: 1.5,
      dashArray: "4 8",
    })
      .addTo(el)
      .bindTooltip(`MOBILITY AI: Arterial diversion cordon`);

    // 4. Safety AI Emergency Dispatches: Find 2 closest emergency stations
    const sortedRes = [...RES].sort(
      (a, b) =>
        Math.hypot(a.lat - markedEvent.lat, a.lng - markedEvent.lng) -
        Math.hypot(b.lat - markedEvent.lat, b.lng - markedEvent.lng),
    );

    sortedRes.slice(0, 2).forEach((res) => {
      const distKm = Math.hypot(res.lat - markedEvent.lat, res.lng - markedEvent.lng) * 111;
      const etaMin = Math.max(3, Math.round(distKm * 2.8));

      // Draw dashed dispatch polyline
      lf.polyline(
        [
          [res.lat, res.lng],
          [markedEvent.lat, markedEvent.lng],
        ],
        {
          color: res.kind === "hospital" ? "#10b981" : "#f59e0b",
          weight: 3,
          dashArray: "6 6",
          opacity: 0.85,
        },
      )
        .addTo(el)
        .bindTooltip(
          `SAFETY AI DISPATCH: ${res.name} → ${markedEvent.locationName} · ETA ${etaMin} min`,
          { sticky: true },
        );

      // Midpoint vehicle badge
      const midLat = (res.lat + markedEvent.lat) / 2;
      const midLng = (res.lng + markedEvent.lng) / 2;
      const unitIcon = lf.divIcon({
        className: "",
        html: `
          <div class="flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 border border-primary/60 text-[9px] font-mono font-bold text-foreground shadow">
            <span>${res.kind === "hospital" ? "🚑" : "🚓"}</span>
            <span>ETA ${etaMin}m</span>
          </div>
        `,
        iconSize: [60, 20],
        iconAnchor: [30, 10],
      });
      lf.marker([midLat, midLng], { icon: unitIcon, interactive: false }).addTo(el);
    });
  }, [markedEvent, handleMarkEvent]);

  // Real BBMP layers: lazy-load on first enable
  useEffect(() => {
    if (!showRoads || roads) return;
    let cancelled = false;
    setDataError(null);
    loadRoads()
      .then((d) => {
        if (!cancelled) setRoads(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setShowRoads(false);
        setDataError(
          err instanceof Error ? err.message : "Could not load the BBMP road-width layer",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [showRoads, roads]);

  useEffect(() => {
    if (!showHealth || health) return;
    let cancelled = false;
    setDataError(null);
    loadHealthCentres()
      .then((d) => {
        if (!cancelled) setHealth(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setShowHealth(false);
        setDataError(err instanceof Error ? err.message : "Could not load the UPHC layer");
      });
    return () => {
      cancelled = true;
    };
  }, [showHealth, health]);

  // Draw the road-width network
  useEffect(() => {
    const lf = L.current,
      g = roadLayer.current;
    if (!lf || !g) return;
    g.clearLayers();
    if (!showRoads || !roads) return;
    const groups = new Map<string, [number, number][][]>();
    for (const road of roads.roads) {
      if (hiddenHierarchies.has(road.hierarchy)) continue;
      const key = roadPalette === "hierarchy" ? road.hierarchy : widthClass(road.widthM).id;
      const bucket = groups.get(key);
      if (bucket) bucket.push(road.coords);
      else groups.set(key, [road.coords]);
    }
    const renderer = roadRenderer.current ?? undefined;
    groups.forEach((parts, key) => {
      const isHierarchy = roadPalette === "hierarchy";
      const meta = isHierarchy
        ? hierarchyMeta(key)
        : (WIDTH_CLASSES.find((c) => c.id === key) ?? WIDTH_CLASSES[0]);
      const weight = isHierarchy
        ? key === "OR"
          ? 3.4
          : key === "MA"
            ? 2.8
            : key === "IR"
              ? 2.4
              : 1.7
        : 1.1 + WIDTH_CLASSES.findIndex((c) => c.id === key) * 0.45;
      lf.polyline(parts, {
        color: meta.color,
        weight,
        opacity: 0.9,
        lineCap: "round",
        smoothFactor: 0.4,
        renderer,
        interactive: false,
      }).addTo(g);
    });
  }, [roads, showRoads, roadPalette, hiddenHierarchies]);

  // BBMP UPHC health centres
  useEffect(() => {
    const lf = L.current,
      g = healthLayer.current;
    if (!lf || !g) return;
    g.clearLayers();
    if (!showHealth || !health) return;
    const zones = health.meta.zones;
    for (const c of health.centres) {
      const color =
        HEALTH_ZONE_COLORS[Math.max(0, zones.indexOf(c.zone)) % HEALTH_ZONE_COLORS.length]!;
      const icon = lf.divIcon({
        className: "",
        html: `<div style="background:${color}" class="flex h-5 w-5 items-center justify-center rounded-sm border-2 border-background text-[13px] font-bold leading-none text-background shadow-lg">+</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      lf.marker([c.lat, c.lng], { icon, title: c.name, riseOnHover: true })
        .addTo(g)
        .bindTooltip(`${esc(c.name)} · ${esc(c.zone)}`, { direction: "top", offset: [0, -10] })
        .bindPopup(
          `<b>${esc(c.name)}</b><br/>UPHC · ${esc(c.zone)} zone` +
            `${c.ward ? `<br/>${esc(c.ward)}` : ""}` +
            `${c.officer ? `<br/>Nodal officer: ${esc(c.officer)}` : ""}` +
            `${c.phone ? `<br/>${esc(c.phone)}` : ""}`,
        );
    }
  }, [showHealth, health]);

  // Highlight the road picked by clicking the BBMP network
  useEffect(() => {
    const lf = L.current,
      m = map.current;
    if (!lf || !m) return;
    pickedLayer.current?.remove();
    pickedLayer.current = null;
    if (!pickedRoad) return;
    pickedLayer.current = lf
      .polyline(pickedRoad.road.coords, {
        color: "#ffffff",
        weight: 7,
        opacity: 0.95,
        lineCap: "round",
        interactive: false,
      })
      .addTo(m);
  }, [pickedRoad]);

  useEffect(() => {
    const z = ZONES.find((x) => x.id === selected);
    if (z && map.current) map.current.flyTo([z.lat, z.lng], 15, { duration: 0.8 });
  }, [selected]);

  // Dispatch routes along real roads (for storm/gas disaster simulation)
  const routeCache = useRef<Record<string, [number, number][]>>({});
  const [routeTick, setRouteTick] = useState(0);
  useEffect(() => {
    if (mode === "road") return;
    dispatches.forEach((d) => {
      const key = `${d.res.id}-${d.zone.id}`;
      if (routeCache.current[key]) return;
      routeCache.current[key] = [
        [d.res.lat, d.res.lng],
        [d.zone.lat, d.zone.lng],
      ];
      fetch(
        `https://router.project-osrm.org/route/v1/driving/${d.res.lng},${d.res.lat};${d.zone.lng},${d.zone.lat}?overview=full&geometries=geojson`,
      )
        .then((r) => r.json())
        .then((j) => {
          const coords: [number, number][] | undefined = j?.routes?.[0]?.geometry?.coordinates?.map(
            (c: [number, number]) => [c[1], c[0]],
          );
          if (coords?.length) {
            routeCache.current[key] = coords;
            setRouteTick((t) => t + 1);
          }
        })
        .catch(() => {});
    });
  }, [dispatches, mode]);

  useEffect(() => {
    const lf = L.current,
      g = lines.current;
    if (!lf || !g) return;
    if (mode === "road") {
      g.clearLayers();
      return;
    }
    g.clearLayers();
    const col = cssVar("--primary"),
      ok = cssVar("--success");
    dispatches.forEach((d) => {
      const path = routeCache.current[`${d.res.id}-${d.zone.id}`] ?? [
        [d.res.lat, d.res.lng],
        [d.zone.lat, d.zone.lng],
      ];
      const onScene = d.status === "ON SCENE";
      lf.polyline(path, {
        color: onScene ? ok : col,
        weight: 4,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(g);
      const total = 6 + Math.round(dist(d.res, d.zone) * 400);
      const p = onScene ? 1 : Math.min(1, Math.max(0, 1 - d.eta / total));
      const pt = path[Math.min(path.length - 1, Math.round(p * (path.length - 1)))]!;
      lf.circleMarker(pt, {
        radius: 6,
        color: cssVar("--foreground"),
        weight: 2,
        fillColor: onScene ? ok : col,
        fillOpacity: 1,
      })
        .bindTooltip(`${d.res.name} → ${d.zone.name}`)
        .addTo(g);
    });
  }, [dispatches, routeTick, mode]);

  // Simulation loop (only for storm and gas; road mode is purely interactive)
  useEffect(() => {
    if (mode === "idle" || mode === "road") return;
    const end = mode === "storm" ? 34 : 30;
    const t = setTimeout(() => {
      const n = tick + 1;
      const scriptMode = mode as Exclude<Mode, "idle" | "road">;
      const line = SCRIPT[scriptMode]?.[n];
      if (line) push(line[0], line[1], line[2]);
      if (mode === "gas") {
        if (n === 2) {
          setRadio("pending");
          push(
            "RADIO",
            "MAYDAY — active gas leak, HSR Sector 2 overpressure risk. Response required NOW.",
            "warn",
          );
        }
        if (radioRef.current === "pending" && n >= 10) {
          radioRef.current = "handled";
          setRadio("handled");
          setStage(2);
          push("RADIO", "NO RESPONSE on channel 14. Leak escalating — declaring STAGE 2.", "warn");
          push(
            "SYS",
            "STAGE 2: damage radius expanded 500 m → 1,000 m. Adjacent zones at risk.",
            "warn",
          );
        }
      }
      const peak = mode === "storm" ? 20 : 16;
      setDepth((prev) => {
        const next: Record<string, number> = {};
        ZONES.forEach((z) => {
          const focus =
            mode === "gas"
              ? z.id === "HSR"
                ? stage === 2
                  ? 2.4
                  : 1.6
                : stage === 2
                  ? 0.4
                  : 0.1
              : z.sens;
          const delta = n <= peak ? 0.045 * focus : -0.05 * focus;
          next[z.id] = Math.max(0.03, +((prev[z.id] ?? 0) + delta).toFixed(3));
        });
        return next;
      });
      if (n === 8 || n === 11 || n === 14) {
        const kind: Kind = n === 8 ? "police" : n === 11 ? "shelter" : "hospital";
        const worst =
          mode === "gas"
            ? [ZONES.find((z) => z.id === "HSR")!]
            : [...ZONES]
                .sort((a, b) => (depthRef.current[b.id] ?? 0) - (depthRef.current[a.id] ?? 0))
                .slice(0, 2);
        setDispatches((ds) => [
          ...ds.filter(
            (e) =>
              !worst.some((z) => e.id === `${RES.find((r) => r.kind === kind)!.id}-${z.id}-${n}`),
          ),
          ...worst.map((z) => {
            const res = RES.filter((r) => r.kind === kind).sort(
              (a, b) => dist(a, z) - dist(b, z),
            )[0]!;
            return {
              id: `${res.id}-${z.id}-${n}`,
              res,
              zone: z,
              status: "EN ROUTE" as const,
              eta: 6 + Math.round(dist(res, z) * 400),
            };
          }),
        ]);
      }
      setDispatches((ds) =>
        ds.map((d) =>
          d.eta <= 1 ? { ...d, eta: 0, status: "ON SCENE" } : { ...d, eta: d.eta - 1 },
        ),
      );
      if (n >= end) {
        setMode("idle");
        push("SYS", "Simulation complete. All units reporting.", "ok");
      }
      setTick(n);
    }, 700);
    return () => clearTimeout(t);
  }, [mode, tick, stage, push]);

  // Gas hazard ring
  useEffect(() => {
    const lf = L.current,
      m = map.current;
    if (!lf || !m) return;
    if (mode === "gas") {
      const col = stage === 2 ? cssVar("--destructive") : cssVar("--primary");
      if (!hazard.current) {
        hazard.current = lf
          .circle([12.9116, 77.6474], { radius: 500, dashArray: "4 6", fillOpacity: 0.08 })
          .addTo(m)
          .bindTooltip("Gas leak cordon");
      }
      hazard.current.setRadius(stage === 2 ? 1000 : 500);
      hazard.current.setStyle({
        color: col,
        fillColor: col,
        weight: 2,
        fillOpacity: stage === 2 ? 0.14 : 0.08,
      });
      hazard.current.setTooltipContent(
        stage === 2 ? "Gas leak cordon — STAGE 2 · radius expanded" : "Gas leak cordon",
      );
    }
    if ((mode === "idle" || mode === "road") && hazard.current) {
      hazard.current.remove();
      hazard.current = null;
    }
  }, [mode, stage]);

  const run = (m: Exclude<Mode, "idle">) => {
    if (m === "road") {
      if (mode === "road") {
        setMode("idle");
        setClosurePoint(null);
        push("SYS", "Road closure mode exited. Map returned to standby.", "sys");
        return;
      }
      setDispatches([]);
      setTick(0);
      setStage(1);
      setRadio("none");
      setMode("road");
      push("SYS", "Interactive Road Closure Studio activated. Mock disaster data removed.", "ok");
      push(
        "SYS",
        "Freely select any location in Bangalore. Drag pins (🏁, 🎯, 🚧) directly on map.",
        "ok",
      );
      return;
    }

    const t0 = performance.now();
    setDispatches([]);
    setDepth(Object.fromEntries(ZONES.map((z) => [z.id, 0.05 * z.sens])));
    setTick(0);
    setStage(1);
    setRadio("none");
    setMode(m);
    push(
      "SYS",
      m === "storm"
        ? "Scenario: Monsoon cloudburst — 34 steps"
        : "Scenario: Gas leak, HSR Sector 2 — 30 steps",
      "warn",
    );
    setCompute(Math.round(performance.now() - t0 + 40 + Math.random() * 30));
  };

  const handleRadio = () => {
    radioRef.current = "handled";
    setRadio("handled");
    push("RADIO", "COPY, channel 14. Fire-3 + EMS responding to HSR Sector 2.", "ok");
    push("SYS", "Response acknowledged — cordon holding, Stage 2 averted.", "ok");
  };

  const toggleRoads = () => {
    const next = !showRoads;
    setShowRoads(next);
    if (!next) {
      setPickedRoad(null);
      roadLayer.current?.clearLayers();
    }
  };

  const toggleHealth = () => {
    const next = !showHealth;
    setShowHealth(next);
    if (!next) healthLayer.current?.clearLayers();
  };

  const toggleHierarchy = (code: string) => {
    setHiddenHierarchies((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const sorted = useMemo(
    () => [...ZONES].sort((a, b) => (depth[b.id] ?? 0) - (depth[a.id] ?? 0)),
    [depth],
  );
  const avg = ZONES.reduce((s, z) => s + (depth[z.id] ?? 0), 0) / ZONES.length;
  const critical = ZONES.filter((z) => (depth[z.id] ?? 0) > 0.6).length;
  const affected = ZONES.filter((z) => (depth[z.id] ?? 0) > 0.3).length;
  const live = mode !== "idle";
  const risk = Math.min(99, Math.round(avg * 110));
  const evac = Math.min(100, dispatches.filter((d) => d.status === "ON SCENE").length * 17);
  const buses =
    mode === "storm" && tick >= 10
      ? 8
      : mode === "gas" && tick >= 10
        ? 3
        : dispatches.length
          ? 8
          : 0;

  const kpis =
    mode === "road"
      ? [
          ["ROAD CLOSED", closurePoint ? closurePoint.name.split(" ")[0] : "NONE"],
          ["DETOUR TRIP", bestRoute ? `${bestRoute.durationMin.toFixed(1)}m` : "—"],
          [
            "ADDED DELAY",
            bestRoute && baselineRoute
              ? `+${Math.max(0, bestRoute.durationMin - baselineRoute.durationMin).toFixed(1)}m`
              : "0m",
          ],
          ["DIVERTED", closurePoint ? `${Math.round(roadImpact.divertedPcuPerHour / 100)}k` : "0"],
        ]
      : [
          ["CROWD RISK", live || risk > 10 ? `${risk}%` : "—"],
          ["EVACUATION", evac ? `${evac}%` : "—"],
          [
            "RESPONSE",
            dispatches.length
              ? `${Math.round(dispatches.reduce((s, d) => s + d.eta, 0) / dispatches.length)}m`
              : "—",
          ],
          ["BUSES", buses],
        ];
  const unit = mode === "gas" ? "% LEL" : mode === "road" ? "min" : "m";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex h-screen flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 font-mono text-xs">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-lg font-bold tracking-[0.25em] text-accent">
              NAMMAMAYOR<span className="text-muted-foreground">OS</span>
            </Link>
            <span className="hidden rounded-sm border border-accent/40 px-2 py-1 text-accent md:inline">
              Government · BBMP
            </span>
            <span className="hidden text-muted-foreground md:inline">
              Bangalore ·{" "}
              {markedEvent
                ? `${markedEvent.typeName} marked`
                : live
                  ? mode === "storm"
                    ? "Monsoon event"
                    : mode === "road"
                      ? "Road Closure Studio"
                      : stage === 2
                        ? "Gas leak · STAGE 2"
                        : "Gas leak"
                  : "Standby"}
            </span>
          </div>
          <div className="flex items-center gap-2 tracking-[0.2em]">
            <span
              className={`h-2 w-2 rounded-full ${live || markedEvent ? "bg-destructive pulse-ring" : "bg-success"}`}
            />
            {live || markedEvent ? (
              <span className="text-destructive">
                LIVE {markedEvent ? "· 5 AI RESPONDING" : mode === "road" ? "· CLOSURE PLANNER" : `· T+${tick}`}
              </span>
            ) : (
              "STANDBY"
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/events"
              className="rounded-sm border border-border px-3 py-1.5 text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              EVENTS →
            </Link>
            <span className="text-muted-foreground">{clock} IST</span>
            <button
              onClick={() => run("storm")}
              disabled={live && mode !== "storm"}
              className="rounded-sm border border-accent px-4 py-2 font-semibold tracking-widest text-accent hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
            >
              ▶ RUN DEMO
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* left */}
          <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-card/60 p-4">
            {/* 🚨 MARK MAP EVENT STUDIO FOR 5 AI */}
            <div className="space-y-3 rounded-sm border border-destructive/60 bg-destructive/10 p-3 font-mono text-xs shadow-md">
              <div className="flex items-center justify-between">
                <span className="font-bold text-destructive flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-destructive animate-ping" />
                  🚨 MARK MAP EVENT
                </span>
                {markedEvent && (
                  <button
                    onClick={handleClearEvent}
                    className="text-[10px] text-muted-foreground hover:text-destructive underline"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="text-[10px] text-muted-foreground leading-relaxed">
                Click below, then click any location on the map. The 5 AI agents will immediately mobilize, coordinate in chat, and deploy dispatches.
              </div>

              <button
                onClick={() => setEventMarkMode((prev) => !prev)}
                className={`w-full py-2.5 px-3 rounded-sm font-bold tracking-wider text-xs transition-all flex items-center justify-center gap-2 ${
                  eventMarkMode
                    ? "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/50 animate-pulse border-2 border-white"
                    : "bg-destructive/20 border border-destructive/60 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                }`}
              >
                <span>{eventMarkMode ? "🎯 CLICK MAP TO DROP PIN..." : "📍 ACTIVATE EVENT MARKER"}</span>
              </button>

              <div className="space-y-1">
                <div className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">
                  Incident Category:
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {EVENT_TYPES.map((et) => (
                    <button
                      key={et.type}
                      onClick={() => {
                        setSelectedEventType(et);
                        if (!eventMarkMode) setEventMarkMode(true);
                      }}
                      className={`p-1.5 rounded-sm border text-left text-[10px] transition-colors ${
                        selectedEventType.type === et.type
                          ? "border-destructive bg-destructive/30 text-white font-bold"
                          : "border-border/60 hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <span className="mr-1">{et.icon}</span>
                      {et.name.split("/")[0]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1 pt-1 border-t border-border/40">
                <div className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">
                  Quick Presets (1-Click Test):
                </div>
                <div className="flex flex-wrap gap-1">
                  {PRESET_EVENTS.map((pe) => (
                    <button
                      key={pe.id}
                      onClick={() =>
                        handleMarkEvent(pe.lat, pe.lng, {
                          type: pe.type,
                          name: pe.name,
                          icon: pe.icon,
                          severity: pe.severity,
                          radius: pe.radius,
                          desc: pe.desc,
                        })
                      }
                      className="px-2 py-1 rounded-sm border border-border/60 text-[10px] hover:border-destructive/80 hover:bg-destructive/20 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {pe.icon} {pe.locationName.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={() => run("gas")}
              disabled={live && mode !== "gas"}
              className="rounded-sm bg-primary py-3 font-mono text-sm font-bold tracking-widest text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              🔥 GAS LEAK MODE
            </button>

            <button
              onClick={() => run("road")}
              className={`rounded-sm border py-3 font-mono text-sm font-bold tracking-widest transition-all ${
                mode === "road"
                  ? "border-destructive bg-destructive text-destructive-foreground shadow-lg shadow-destructive/20"
                  : "border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              }`}
            >
              {mode === "road" ? "🚧 ROAD CLOSURE [ACTIVE]" : "🚧 ROAD CLOSURE"}
            </button>

            {mode === "road" && (
              <div className="space-y-3 rounded-sm border border-destructive/40 bg-background/80 p-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="font-bold text-destructive">🚧 ROAD CLOSURE PLANNER</span>
                  <button
                    onClick={() => {
                      setMode("idle");
                      setClosurePoint(null);
                    }}
                    className="rounded-sm border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                    title="Exit Road Closure Studio"
                  >
                    EXIT ✕
                  </button>
                </div>

                <div className="text-[10px] text-muted-foreground leading-relaxed">
                  Freely select any location in Bangalore. Drag pins (🏁, 🎯, 🚧) directly on the
                  map, or pick below.
                </div>

                {/* Location Search / Filter */}
                <div className="space-y-1">
                  <input
                    type="text"
                    placeholder="Search location e.g. Whitefield, Indiranagar, Hebbal..."
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    className="w-full rounded-sm border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none"
                  />
                </div>

                {/* TRIP ORIGIN (START) */}
                <div className="space-y-1 pt-1 border-t">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-emerald-500 font-bold flex items-center gap-1">
                      <span>🏁 TRIP ORIGIN</span>
                    </span>
                    <button
                      onClick={() => setMapPickMode((m) => (m === "origin" ? "none" : "origin"))}
                      className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                        mapPickMode === "origin"
                          ? "border-emerald-500 bg-emerald-500 text-white animate-pulse"
                          : "text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10"
                      }`}
                    >
                      {mapPickMode === "origin" ? "CLICK ON MAP..." : "📍 PICK ON MAP"}
                    </button>
                  </div>

                  <select
                    value={origin.id}
                    onChange={(e) => {
                      const loc = CITY_LOCATIONS.find((l) => l.id === e.target.value);
                      if (loc) {
                        setOrigin(loc);
                        push("MOBILITY", `Trip Origin changed to: ${loc.name}.`, "agent");
                      }
                    }}
                    className="w-full rounded-sm border bg-background p-1.5 font-mono text-[11px] text-foreground focus:border-emerald-500 focus:outline-none"
                  >
                    {origin.isCustom && <option value={origin.id}>📍 {origin.name}</option>}
                    {filteredLocationsByZone.map(([zone, locs]) => (
                      <optgroup key={zone} label={`${zone} Bangalore`}>
                        {locs.map((l) => (
                          <option key={l.id} value={l.id} disabled={l.id === destination.id}>
                            {l.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* SWAP BUTTON */}
                <div className="flex justify-center -my-1">
                  <button
                    onClick={handleSwapOriginDestination}
                    className="rounded-full border border-muted bg-card px-2 py-0.5 text-[10px] text-muted-foreground hover:border-accent hover:text-accent shadow-sm"
                    title="Swap Origin and Destination"
                  >
                    ⇅ SWAP ORIGIN / DESTINATION
                  </button>
                </div>

                {/* TRIP DESTINATION */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-sky-400 font-bold flex items-center gap-1">
                      <span>🎯 DESTINATION</span>
                    </span>
                    <button
                      onClick={() =>
                        setMapPickMode((m) => (m === "destination" ? "none" : "destination"))
                      }
                      className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                        mapPickMode === "destination"
                          ? "border-sky-500 bg-sky-500 text-white animate-pulse"
                          : "text-sky-400 border-sky-500/40 hover:bg-sky-500/10"
                      }`}
                    >
                      {mapPickMode === "destination" ? "CLICK ON MAP..." : "🎯 PICK ON MAP"}
                    </button>
                  </div>

                  <select
                    value={destination.id}
                    onChange={(e) => {
                      const loc = CITY_LOCATIONS.find((l) => l.id === e.target.value);
                      if (loc) {
                        setDestination(loc);
                        push("MOBILITY", `Destination changed to: ${loc.name}.`, "agent");
                      }
                    }}
                    className="w-full rounded-sm border bg-background p-1.5 font-mono text-[11px] text-foreground focus:border-sky-500 focus:outline-none"
                  >
                    {destination.isCustom && (
                      <option value={destination.id}>🎯 {destination.name}</option>
                    )}
                    {filteredLocationsByZone.map(([zone, locs]) => (
                      <optgroup key={zone} label={`${zone} Bangalore`}>
                        {locs.map((l) => (
                          <option key={l.id} value={l.id} disabled={l.id === origin.id}>
                            {l.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* ROAD CLOSURE SECTION */}
                <div className="space-y-1.5 pt-2 border-t">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-destructive font-bold flex items-center gap-1">
                      <span>🚧 ROAD CLOSURE LOCATION</span>
                    </span>
                    <button
                      onClick={() => setMapPickMode((m) => (m === "closure" ? "none" : "closure"))}
                      className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold transition-colors ${
                        mapPickMode === "closure"
                          ? "border-destructive bg-destructive text-white animate-pulse"
                          : "text-destructive border-destructive/40 hover:bg-destructive/10"
                      }`}
                    >
                      {mapPickMode === "closure" ? "CLICK ON MAP..." : "🚧 PICK ON MAP"}
                    </button>
                  </div>

                  <select
                    value={closurePoint?.id ?? ""}
                    onChange={(e) => {
                      if (!e.target.value) {
                        setClosurePoint(null);
                        push("MOBILITY", "Road closure lifted. Corridors clear.", "ok");
                        return;
                      }
                      const loc = CITY_LOCATIONS.find((l) => l.id === e.target.value);
                      if (loc) {
                        setClosurePoint(loc);
                        push(
                          "MOBILITY",
                          `🚨 Road closed at: ${loc.name}. Calculating detour corridors...`,
                          "warn",
                        );
                      }
                    }}
                    className="w-full rounded-sm border bg-background p-1.5 font-mono text-[11px] text-foreground focus:border-destructive focus:outline-none"
                  >
                    <option value="">— No Road Closed (Open Traffic) —</option>
                    {closurePoint?.isCustom && (
                      <option value={closurePoint.id}>🚧 {closurePoint.name}</option>
                    )}
                    {CITY_LOCATIONS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>

                  {closurePoint ? (
                    <div className="rounded-sm border border-destructive/60 bg-destructive/10 p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-destructive flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-destructive pulse-ring" />
                          <span>{closurePoint.name}</span>
                        </span>
                        <button
                          onClick={() => {
                            setClosurePoint(null);
                            push("MOBILITY", "Road closure cleared by operator.", "ok");
                          }}
                          className="rounded-sm border border-destructive bg-destructive px-1.5 py-0.5 text-[9px] font-bold text-white hover:opacity-90"
                        >
                          REOPEN
                        </button>
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {closurePoint.lat.toFixed(4)}, {closurePoint.lng.toFixed(4)} · Drag 🚧 on
                        map to move
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-sm border border-dashed border-muted p-1.5 text-center text-[10px] text-muted-foreground">
                      No road closed. Click "Pick on Map" or select above to place a road block.
                    </div>
                  )}
                </div>

                {/* ALTERNATE ROUTES */}
                <div className="space-y-1.5 pt-2 border-t">
                  <div className="flex items-center justify-between text-[10px] tracking-wider text-muted-foreground">
                    <span>COMPUTED ROUTES ({routes.length})</span>
                    {isCalculating && <span className="text-accent animate-pulse">Routing…</span>}
                    {!isCalculating && bestRoute && baselineRoute && closurePoint && (
                      <span className="text-amber-400 font-bold">
                        +{Math.max(0, bestRoute.durationMin - baselineRoute.durationMin).toFixed(1)}
                        m delay
                      </span>
                    )}
                  </div>

                  {routes.map((rt, idx) => {
                    const isPrimary = idx === 0;
                    const isSelected = activeAltIndex === idx;
                    const added = baselineRoute
                      ? Math.max(0, rt.durationMin - baselineRoute.durationMin)
                      : 0;
                    const badgeCol = isPrimary
                      ? "border-blue-500 bg-blue-500/15 text-blue-400 font-bold"
                      : idx === 1
                        ? "border-cyan-500 bg-cyan-500/15 text-cyan-400"
                        : "border-amber-500 bg-amber-500/15 text-amber-400";
                    const borderCol = isSelected
                      ? isPrimary
                        ? "border-blue-500 ring-1 ring-blue-500/40"
                        : idx === 1
                          ? "border-cyan-500"
                          : "border-amber-500"
                      : "border-border";

                    return (
                      <button
                        key={rt.id}
                        onClick={() => setActiveAltIndex(idx)}
                        className={`w-full text-left rounded-sm border p-2 transition-all ${borderCol} ${
                          isSelected ? "bg-card shadow-sm" : "bg-background/40 hover:bg-card/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`rounded-sm border px-1.5 py-0.5 text-[9px] font-bold ${badgeCol}`}
                          >
                            {closurePoint
                              ? isPrimary
                                ? "★ RECOMMENDED DETOUR"
                                : `ALT ${idx + 1}`
                              : isPrimary
                                ? "★ FASTEST ROUTE"
                                : `ALT ${idx + 1}`}
                          </span>
                          <span className="font-bold text-foreground">
                            {rt.durationMin.toFixed(1)} min · {rt.distanceKm.toFixed(1)} km
                          </span>
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground truncate">
                          {rt.via}
                        </div>
                        {closurePoint && baselineRoute && (
                          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>Normal: {baselineRoute.durationMin.toFixed(1)}m</span>
                            <span
                              className={
                                added > 0 ? "text-amber-400 font-bold" : "text-sky-400 font-bold"
                              }
                            >
                              {added > 0 ? `+${added.toFixed(1)} min delay` : "Direct corridor"}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {live && mode !== "road" && (
              <button
                onClick={() => {
                  lines.current?.clearLayers();
                  setMode("idle");
                  push("SYS", "Simulation aborted by operator", "warn");
                }}
                className="rounded-sm border border-destructive py-2 font-mono text-xs text-destructive"
              >
                ■ ABORT
              </button>
            )}

            <div className="border-t pt-3">
              <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                COMPUTE
              </div>
              <div className="text-2xl font-bold">{compute ? `${compute} ms` : "-- ms"}</div>
            </div>

            {mode !== "road" && (
              <div className="border-t pt-3">
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                  MAP LAYERS
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(Object.keys(showKinds) as Kind[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => setShowKinds((s) => ({ ...s, [k]: !s[k] }))}
                      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] capitalize ${
                        showKinds[k] ? "" : "opacity-40"
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${KIND_CLASS[k]}`} />
                      {k}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                  BBMP REAL DATA
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {roads ? `${roads.meta.segments.toLocaleString()} SEG` : "KML"}
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                <button
                  onClick={toggleRoads}
                  data-testid="toggle-roads"
                  className={`flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 font-mono text-[11px] ${
                    showRoads ? "border-accent/60 text-accent" : "text-muted-foreground"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ background: "linear-gradient(135deg,#f87171,#fbbf24,#4ade80)" }}
                  />
                  <span>Road width map</span>
                  <span className="ml-auto text-muted-foreground">
                    {roads
                      ? `${roads.meta.totalKm.toLocaleString()} km`
                      : showRoads
                        ? "loading…"
                        : "23.3k"}
                  </span>
                </button>
                <button
                  onClick={toggleHealth}
                  data-testid="toggle-health"
                  className={`flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 font-mono text-[11px] ${
                    showHealth ? "border-accent/60 text-accent" : "text-muted-foreground"
                  }`}
                >
                  <span className="flex h-3 w-3 items-center justify-center rounded-sm bg-accent text-[9px] font-bold text-accent-foreground">
                    +
                  </span>
                  <span>UPHC health centres</span>
                  <span className="ml-auto text-muted-foreground">
                    {health ? health.centres.length : showHealth ? "loading…" : "139"}
                  </span>
                </button>
              </div>
              {dataError && <div className="mt-2 text-[10px] text-destructive">{dataError}</div>}

              {showRoads && roads && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-1 font-mono text-[10px]">
                    {(["hierarchy", "width"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => setRoadPalette(p)}
                        className={`flex-1 rounded-sm border px-2 py-1 ${
                          roadPalette === p ? "border-accent text-accent" : "text-muted-foreground"
                        }`}
                      >
                        {p === "hierarchy" ? "BY CLASS" : "BY WIDTH"}
                      </button>
                    ))}
                  </div>

                  {roadPalette === "hierarchy" ? (
                    <div className="flex flex-wrap gap-1">
                      {roads.meta.hierarchies.map((h) => {
                        const m = hierarchyMeta(h);
                        const active = !hiddenHierarchies.has(h);
                        return (
                          <button
                            key={h}
                            onClick={() => toggleHierarchy(h)}
                            title={m.label}
                            className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${
                              active ? "" : "opacity-40"
                            }`}
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: m.color }}
                            />
                            {h}
                            <span className="text-muted-foreground">
                              {roads.meta.hierarchyCounts[h] ?? 0}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-1 font-mono text-[10px]">
                      {WIDTH_CLASSES.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className="h-1.5 w-5 rounded-full"
                            style={{ background: c.color }}
                          />
                          <span>{c.label}</span>
                          <span className="ml-auto">{roads.meta.widthHistogram[c.id] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-[10px] text-muted-foreground">
                    Click a mapped road for its BBMP record.
                  </div>

                  {pickedRoad && (
                    <div className="rounded-sm border bg-background/60 p-2 font-mono text-[10px]">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-accent">
                          {hierarchyMeta(pickedRoad.road.hierarchy).label}
                        </span>
                        <button
                          onClick={() => setPickedRoad(null)}
                          className="text-muted-foreground"
                          aria-label="Clear selected road"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span className="text-muted-foreground">Right-of-way</span>
                        <b>{pickedRoad.road.widthM} m</b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Half-width</span>
                        <b>{pickedRoad.road.halfWidthM} m</b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Segment length</span>
                        <b>{formatKm(pickedRoad.road.lengthM)}</b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Class · type</span>
                        <b>
                          {pickedRoad.road.hierarchy} · {pickedRoad.road.type}
                        </b>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Click offset</span>
                        <b>{Math.round(pickedRoad.distanceM)} m</b>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {showHealth && health && (
                <div className="mt-3 space-y-1 font-mono text-[10px]">
                  <div className="text-muted-foreground">
                    {health.centres.length} UPHCs · {health.meta.zones.length} BBMP zones
                  </div>
                  {health.meta.zones.map((z, i) => (
                    <div key={z} className="flex items-center gap-2 text-muted-foreground">
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ background: HEALTH_ZONE_COLORS[i % HEALTH_ZONE_COLORS.length] }}
                      />
                      <span className="truncate">{z}</span>
                      <span className="ml-auto">
                        {health.centres.filter((c) => c.zone === z).length}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t pt-3">
              <h3 className="font-mono text-sm font-bold tracking-widest text-accent">
                GOVERNMENT DASHBOARD
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {[
                  ["Affected zones", affected],
                  ["Critical zones", critical],
                  ["Max level", `${Math.max(...Object.values(depth)).toFixed(2)}${unit}`],
                  ["Units out", dispatches.length],
                ].map(([l, v]) => (
                  <div key={l as string} className="rounded-sm border bg-background/60 p-3">
                    <div className="font-mono text-[10px] uppercase text-muted-foreground">{l}</div>
                    <div className="mt-1 text-xl font-bold">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* map */}
          <div className={`relative min-w-0 flex-1 ${eventMarkMode ? "cursor-crosshair" : ""}`}>
            <div ref={mapEl} className="h-full w-full bg-background" />

            {/* Hint overlay for event marker mode */}
            {eventMarkMode && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] rounded-sm border-2 border-destructive bg-card/95 px-4 py-2 font-mono text-xs shadow-2xl flex items-center gap-3 backdrop-blur animate-pulse">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-ping" />
                <span>
                  🎯 <b>EVENT MARKER ACTIVE:</b> Click anywhere on Bangalore map to mark{" "}
                  <span className="text-destructive font-bold">{selectedEventType.icon} {selectedEventType.name}</span>
                </span>
                <button
                  onClick={() => setEventMarkMode(false)}
                  className="rounded-sm border border-destructive/50 px-2 py-0.5 text-[10px] hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Marked Event Active Floating Response Matrix */}
            {markedEvent && !eventMarkMode && (
              <div className="absolute top-4 left-4 right-52 z-[500] rounded-sm border border-destructive/60 bg-card/95 p-3 shadow-2xl backdrop-blur font-mono text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white animate-pulse shadow-md">
                      {markedEvent.icon}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-destructive">
                          MAP EVENT ACTIVE: {markedEvent.title.toUpperCase()}
                        </span>
                        <span className="rounded bg-destructive/20 px-1.5 py-0.2 text-[9px] font-extrabold text-destructive border border-destructive/40">
                          {markedEvent.severity}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Location: <b className="text-foreground">{markedEvent.locationName}</b> ({markedEvent.lat.toFixed(4)}, {markedEvent.lng.toFixed(4)}) · 5 AI Agents synchronizing response
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const el = document.getElementById("agent-comms-section");
                        if (el) el.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="rounded-sm border border-accent bg-accent/20 px-2.5 py-1 text-[10px] font-bold text-accent hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      💬 VIEW 5 AI CHAT & WORK ↓
                    </button>
                    <button
                      onClick={handleClearEvent}
                      className="rounded-sm border border-border px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive transition-colors"
                    >
                      CLEAR EVENT ✕
                    </button>
                  </div>
                </div>

                {/* 5 AI Work Status Matrix on Map */}
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-5 text-[10px]">
                  <div className="rounded border border-accent/40 bg-background/60 p-1.5">
                    <span className="font-bold text-accent flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent animate-ping" />
                      PREDICTION AI
                    </span>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 leading-tight">{markedEvent.workStatus.prediction}</div>
                  </div>
                  <div className="rounded border border-primary/40 bg-background/60 p-1.5">
                    <span className="font-bold text-primary flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
                      FORECAST AI
                    </span>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 leading-tight">{markedEvent.workStatus.forecast}</div>
                  </div>
                  <div className="rounded border border-success/40 bg-background/60 p-1.5">
                    <span className="font-bold text-success flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-success animate-ping" />
                      MOBILITY AI
                    </span>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 leading-tight">{markedEvent.workStatus.mobility}</div>
                  </div>
                  <div className="rounded border border-destructive/40 bg-background/60 p-1.5">
                    <span className="font-bold text-destructive flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-ping" />
                      SAFETY AI
                    </span>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 leading-tight">{markedEvent.workStatus.safety}</div>
                  </div>
                  <div className="rounded border border-cyan-400/40 bg-background/60 p-1.5">
                    <span className="font-bold text-cyan-400 flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
                      COMMS AI
                    </span>
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 leading-tight">{markedEvent.workStatus.comms}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Hint overlay for picking mode */}
            {mode === "road" && mapPickMode !== "none" && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] rounded-sm border border-accent bg-card/95 px-4 py-2 font-mono text-xs shadow-2xl flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-accent animate-ping" />
                <span>
                  Click anywhere on the map to set{" "}
                  <b>
                    {mapPickMode === "origin"
                      ? "Trip Origin (Start)"
                      : mapPickMode === "destination"
                        ? "Destination"
                        : "Road Closure"}
                  </b>
                </span>
                <button
                  onClick={() => setMapPickMode("none")}
                  className="rounded-sm border px-2 py-0.5 text-[10px] hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            )}

            {live && radio === "pending" && (
              <div className="absolute bottom-6 left-4 z-[500] w-72 rounded-sm border border-destructive bg-card/95 p-3 shadow-xl">
                <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest">
                  <span className="h-2 w-2 rounded-full bg-destructive pulse-ring" />
                  <span className="text-destructive">INCOMING RADIO</span>
                  <span className="ml-auto text-muted-foreground">T+{tick}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Gas leak, HSR Sector 2 — cordon at 500 m. Respond before it escalates.
                </p>
                <button
                  onClick={handleRadio}
                  className="mt-2 w-full rounded-sm bg-primary py-2 font-mono text-xs font-bold tracking-widest text-primary-foreground hover:opacity-90"
                >
                  📡 RESPOND NOW
                </button>
              </div>
            )}
            <div className="pointer-events-none absolute right-4 top-4 z-[500] w-48 space-y-px overflow-hidden rounded-sm border bg-card/90 font-mono text-[10px] tracking-widest">
              {kpis.map(([l, v]) => (
                <div
                  key={l as string}
                  className="flex items-center justify-between border-b px-3 py-2.5 last:border-0"
                >
                  <span className="text-muted-foreground">{l}</span>
                  <span className="text-base font-bold text-accent">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* right */}
          <aside className="hidden w-80 shrink-0 flex-col border-l bg-card/60 lg:flex">
            <div className="border-b p-4">
              <div className="font-semibold text-accent">🏛 Government · BBMP</div>
              <div className="text-xs text-muted-foreground">Control room · Full access</div>
            </div>
            <div className="flex border-b font-mono text-xs">
              {(["Overview", "Reports", "Resources", "Triage"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-3 ${tab === t ? "border-b-2 border-accent text-accent" : "text-muted-foreground"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 text-sm">
              {tab === "Overview" && (
                <>
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    CITY DATA · BBMP
                  </div>
                  <div className="mt-2 space-y-1 rounded-sm border bg-background/60 p-3 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Road segments</span>
                      <b>{roads ? roads.meta.segments.toLocaleString() : "—"}</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Network length</span>
                      <b>{roads ? `${roads.meta.totalKm.toLocaleString()} km` : "—"}</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Widest right-of-way</span>
                      <b>{roads ? `${roads.meta.widthRange.max} m` : "—"}</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">UPHC centres</span>
                      <b>{health ? health.centres.length : "—"}</b>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {roads || health
                      ? "Loaded from BBMP KML exports."
                      : "Enable a BBMP layer on the map to load the real dataset."}
                  </div>

                  {mode === "road" ? (
                    <>
                      <div className="mt-5 font-mono text-[10px] tracking-widest text-muted-foreground">
                        TRAFFIC IMPACT LOGIC ·{" "}
                        {closurePoint ? closurePoint.name.toUpperCase() : "NO CLOSURE"}
                      </div>
                      <div className="mt-2 space-y-1 rounded-sm border bg-background/60 p-3 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Trip Corridor</span>
                          <span className="font-bold">
                            {origin.name.split(" ")[0]} → {destination.name.split(" ")[0]}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Normal trip (baseline)</span>
                          <span className="font-bold">
                            {baselineRoute
                              ? `${baselineRoute.durationMin.toFixed(1)} min (${baselineRoute.distanceKm.toFixed(1)} km)`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Diverted trip (
                            {activeAltIndex === 0 ? "detour" : `alt ${activeAltIndex + 1}`})
                          </span>
                          <span
                            className={`font-bold ${
                              bestRoute &&
                              baselineRoute &&
                              bestRoute.durationMin > baselineRoute.durationMin
                                ? "text-destructive"
                                : "text-success"
                            }`}
                          >
                            {bestRoute
                              ? `${bestRoute.durationMin.toFixed(1)} min (${bestRoute.distanceKm.toFixed(1)} km)`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Added commuter delay</span>
                          <span className="font-bold text-primary">
                            {bestRoute && baselineRoute
                              ? `+${Math.max(0, bestRoute.durationMin - baselineRoute.durationMin).toFixed(1)} min`
                              : "0 min"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Queue spillover estimate</span>
                          <span className="font-bold">
                            {closurePoint ? `${roadImpact.queueM} m` : "0 m"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Person-hours lost / h</span>
                          <span className="font-bold">
                            {closurePoint ? roadImpact.personHoursPerHour : "0"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Off-peak shift (23–05)</span>
                          <span className="font-bold text-success">
                            {closurePoint
                              ? `${roadImpact.personHoursSavedByNight} person-h saved`
                              : "Normal"}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 font-mono text-[10px] tracking-widest text-muted-foreground">
                        ALTERNATE ROUTES COMPARISON
                      </div>
                      {routes.map((rt, i) => (
                        <div
                          key={rt.id}
                          onClick={() => setActiveAltIndex(i)}
                          className={`flex justify-between border-b py-2 text-xs cursor-pointer hover:bg-secondary/40 px-1 rounded-sm ${
                            activeAltIndex === i ? "bg-secondary font-semibold" : ""
                          }`}
                        >
                          <span>
                            {closurePoint
                              ? i === 0
                                ? "★ Detour (Recommended)"
                                : `Alternative ${i + 1}`
                              : i === 0
                                ? "★ Fastest Route"
                                : `Alternative ${i + 1}`}
                          </span>
                          <span className="text-muted-foreground">
                            {rt.durationMin.toFixed(1)} min · {rt.distanceKm.toFixed(1)} km
                          </span>
                        </div>
                      ))}

                      <div className="mt-4 font-mono text-[10px] tracking-widest text-muted-foreground">
                        VEHICLE DIVERSION SPLIT
                      </div>
                      {VEHICLE_CLASSES.map((v) => (
                        <div key={v.id} className="border-b py-1 text-xs">
                          <div className="flex justify-between">
                            <span>{v.label}</span>
                            <span className="text-muted-foreground">
                              {Math.round(v.volumePerHour / v.pcuPerVehicle)}/h
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground">{v.action}</div>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <div className="mt-5 font-mono text-[10px] tracking-widest text-muted-foreground">
                        SIMULATION METRICS
                      </div>
                      <div className="mt-2 flex items-center justify-between rounded-sm border bg-background/60 p-3">
                        <span className="text-xs text-muted-foreground">
                          {mode === "gas" ? "Average gas level" : "Average flood depth"}
                        </span>
                        <span className="text-lg font-bold">
                          {avg.toFixed(2)}
                          {unit}
                        </span>
                      </div>
                      <div className="mt-5 font-mono text-[10px] tracking-widest text-muted-foreground">
                        ZONE SEVERITY
                      </div>
                      {sorted.map((z) => {
                        const v = depth[z.id] ?? 0;
                        return (
                          <button
                            key={z.id}
                            onClick={() => setSelected(z.id)}
                            className={`flex w-full items-center gap-2 border-b py-2.5 text-left ${selected === z.id ? "bg-secondary" : ""}`}
                          >
                            <span className="w-28 truncate">{z.name}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <span
                                className={`block h-full transition-all ${
                                  v > 0.6 ? "bg-destructive" : v > 0.3 ? "bg-primary" : "bg-accent"
                                }`}
                                style={{ width: `${Math.min(100, v * 100)}%` }}
                              />
                            </span>
                            <span className="w-14 text-right font-mono text-xs text-primary">
                              {v.toFixed(2)}
                              {unit}
                            </span>
                          </button>
                        );
                      })}
                      <div className="mt-5 font-mono text-[10px] tracking-widest text-muted-foreground">
                        DISPATCHES ({dispatches.length})
                      </div>
                      {dispatches.length === 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">No active dispatches</p>
                      ) : (
                        dispatches.map((d) => (
                          <div
                            key={d.id}
                            className="mt-2 rounded-sm border bg-background/60 p-2 text-xs"
                          >
                            <div className="flex justify-between">
                              <span>{d.res.name}</span>
                              <span
                                className={
                                  d.status === "ON SCENE" ? "text-success" : "text-primary"
                                }
                              >
                                {d.status}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              → {d.zone.name}
                              {d.eta > 0 && ` · ETA ${d.eta}m`}
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}
                </>
              )}
              {tab === "Reports" && (
                <div className="space-y-2">
                  {feed.filter((f) => f.agent !== "SYS").length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No agent reports yet. Select a road closure or run a simulation.
                    </p>
                  )}
                  {feed
                    .filter((f) => f.agent !== "SYS")
                    .map((f, i) => (
                      <div key={i} className="rounded-sm border bg-background/60 p-2 text-xs">
                        <span className="font-mono text-accent">{f.agent}</span>{" "}
                        <span className="text-muted-foreground">{f.t}</span>
                        <div className="mt-1">{f.msg}</div>
                      </div>
                    ))}
                </div>
              )}
              {tab === "Resources" &&
                RES.map((r) => {
                  const busy = dispatches.some((d) => d.res.id === r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => map.current?.flyTo([r.lat, r.lng], 16)}
                      className="flex w-full items-center gap-2 border-b py-2 text-left"
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-background ${KIND_CLASS[r.kind]}`}
                      >
                        {GLYPH[r.kind]}
                      </span>
                      <span className="flex-1">{r.name}</span>
                      <span
                        className={`font-mono text-[10px] ${busy ? "text-primary" : "text-success"}`}
                      >
                        {busy ? "DEPLOYED" : "READY"}
                      </span>
                    </button>
                  );
                })}
              {tab === "Triage" &&
                sorted.map((z, i) => {
                  const v = depth[z.id] ?? 0;
                  const p = v > 0.6 ? "P1 · CRITICAL" : v > 0.3 ? "P2 · HIGH" : "P3 · MONITOR";
                  return (
                    <div key={z.id} className="mb-2 rounded-sm border bg-background/60 p-3">
                      <div className="flex justify-between text-xs">
                        <span className="font-semibold">
                          #{i + 1} {z.name}
                        </span>
                        <span
                          className={
                            v > 0.6
                              ? "text-destructive"
                              : v > 0.3
                                ? "text-primary"
                                : "text-muted-foreground"
                          }
                        >
                          {p}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Est. {Math.round(v * 4200).toLocaleString()} residents exposed
                      </div>
                    </div>
                  );
                })}
            </div>
          </aside>
        </div>
      </div>
      <CommandPanels
        feed={feed}
        depth={depth}
        zones={ZONES}
        live={live || !!markedEvent}
        mode={mode}
        markedEvent={markedEvent}
        onClearEvent={handleClearEvent}
      />
    </div>
  );
}
