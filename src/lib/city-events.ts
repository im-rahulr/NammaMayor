// Scheduled city-scale events (matches, concerts, marathons, festivals) and a
// deterministic crowd + traffic impact model.
//
// The dataset below is a demo fixture set, not a live ticketing feed. Every
// number is an assumption kept here so the UI stays a thin renderer and the
// LLM agent report has a grounded fallback when the NVIDIA API is unavailable.

export type EventCategory =
  "cricket" | "sport" | "concert" | "marathon" | "cultural" | "expo" | "protest";

export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "SEVERE";

export type EventZone = "Central" | "South" | "Southeast" | "East" | "North" | "West";

export type CityEvent = {
  id: string;
  title: string;
  category: EventCategory;
  venue: string;
  locationName: string;
  zone: EventZone;
  lat: number;
  lng: number;
  /** ISO-8601 with +05:30 offset (IST). */
  startsAt: string;
  endsAt: string;
  /** Expected peak-day attendance (people). */
  expectedAttendance: number;
  /** Published venue capacity (people). */
  venueCapacity: number;
  /** Radius of the modelled impact perimeter (metres). */
  radiusM: number;
  /** Roads the event is expected to load first, highest pressure first. */
  nearbyArterials: string[];
  /** Nearest mass-transit node used for the surge estimate. */
  transitHub: string;
  notes: string;
};

export const EVENT_CATEGORIES: EventCategory[] = [
  "cricket",
  "sport",
  "concert",
  "marathon",
  "cultural",
  "expo",
  "protest",
];

export const EVENT_ZONES: EventZone[] = ["Central", "South", "Southeast", "East", "North", "West"];

export const RISK_LEVELS: RiskLevel[] = ["LOW", "MODERATE", "HIGH", "SEVERE"];

export const EVENT_CATEGORY_META: Record<
  EventCategory,
  { label: string; icon: string; chip: string }
> = {
  cricket: {
    label: "Cricket",
    icon: "🏏",
    chip: "border-success/40 bg-success/10 text-success",
  },
  sport: {
    label: "Sport",
    icon: "🏟️",
    chip: "border-accent/40 bg-accent/10 text-accent",
  },
  concert: {
    label: "Concert",
    icon: "🎤",
    chip: "border-primary/40 bg-primary/10 text-primary",
  },
  marathon: {
    label: "Marathon",
    icon: "🏃",
    chip: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  cultural: {
    label: "Cultural",
    icon: "🪔",
    chip: "border-primary/40 bg-primary/10 text-primary",
  },
  expo: {
    label: "Expo",
    icon: "🏢",
    chip: "border-accent/40 bg-accent/10 text-accent",
  },
  protest: {
    label: "Protest",
    icon: "📣",
    chip: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

export const RISK_META: Record<
  RiskLevel,
  { label: string; chip: string; text: string; hex: string; bar: string }
> = {
  LOW: {
    label: "LOW",
    chip: "border-success/40 bg-success/10 text-success",
    text: "text-success",
    hex: "#3ecf8e",
    bar: "bg-success",
  },
  MODERATE: {
    label: "MODERATE",
    chip: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
    text: "text-yellow-400",
    hex: "#eab308",
    bar: "bg-yellow-400",
  },
  HIGH: {
    label: "HIGH",
    chip: "border-orange-400/40 bg-orange-400/10 text-orange-400",
    text: "text-orange-400",
    hex: "#f97316",
    bar: "bg-orange-400",
  },
  SEVERE: {
    label: "SEVERE",
    chip: "border-destructive/50 bg-destructive/10 text-destructive",
    text: "text-destructive",
    hex: "#ef4444",
    bar: "bg-destructive",
  },
};

// ─── Demo fixture set ─────────────────────────────────────────────────────────
// Upcoming Bengaluru fixtures. Dates are illustrative for the demo window.

export const CITY_EVENTS: CityEvent[] = [
  {
    id: "rcb-mi-2026",
    title: "RCB vs Mumbai Indians · League Fixture",
    category: "cricket",
    venue: "M. Chinnaswamy Stadium",
    locationName: "Chinnaswamy Stadium, MG Road",
    zone: "Central",
    lat: 12.9788,
    lng: 77.5996,
    startsAt: "2026-11-08T19:30:00+05:30",
    endsAt: "2026-11-08T23:15:00+05:30",
    expectedAttendance: 38_000,
    venueCapacity: 40_000,
    radiusM: 900,
    nearbyArterials: ["MG Road", "Cubbon Road", "Queen's Road", "Kasturba Road", "Raj Bhavan Road"],
    transitHub: "MG Road (Purple Line)",
    notes:
      "Sold-out evening fixture. Arrival wave overlaps the 18:00–20:00 city peak and the Metro Cubbon Park interchange.",
  },
  {
    id: "arijit-palace-2026",
    title: "Arijit Singh Live · Palace Grounds",
    category: "concert",
    venue: "Palace Grounds",
    locationName: "Palace Grounds, Jayamahal",
    zone: "Central",
    lat: 13.0055,
    lng: 77.592,
    startsAt: "2026-11-14T18:00:00+05:30",
    endsAt: "2026-11-14T23:00:00+05:30",
    expectedAttendance: 34_000,
    venueCapacity: 35_000,
    radiusM: 1_000,
    nearbyArterials: ["Bellary Road", "Jayamahal Road", "Millers Road", "Cunningham Road"],
    transitHub: "Cantonment (Pink Line)",
    notes:
      "Single-gate arena layout. Post-event egress at 23:00 collides with late-night freight on Bellary Road.",
  },
  {
    id: "bengaluru-marathon-2026",
    title: "Bengaluru City Marathon",
    category: "marathon",
    venue: "Cubbon Park · Queen's Statue",
    locationName: "Cubbon Park, Kasturba Road",
    zone: "Central",
    lat: 12.9763,
    lng: 77.5929,
    startsAt: "2026-11-15T05:00:00+05:30",
    endsAt: "2026-11-15T11:00:00+05:30",
    expectedAttendance: 24_000,
    venueCapacity: 30_000,
    radiusM: 1_800,
    nearbyArterials: [
      "Kasturba Road",
      "MG Road",
      "Cubbon Road",
      "Raj Bhavan Road",
      "Vittal Mallya Road",
    ],
    transitHub: "Cubbon Park (Purple Line)",
    notes:
      "Rolling full and half-marathon closures across the CBD from 04:00. Requires staged reopening plan.",
  },
  {
    id: "kpl-final-2026",
    title: "Karnataka Premier League · Final",
    category: "cricket",
    venue: "Kanteerava Stadium",
    locationName: "Kanteerava Stadium, Kasturba Road",
    zone: "Central",
    lat: 12.9719,
    lng: 77.5936,
    startsAt: "2026-11-22T18:30:00+05:30",
    endsAt: "2026-11-22T22:30:00+05:30",
    expectedAttendance: 14_000,
    venueCapacity: 15_000,
    radiusM: 700,
    nearbyArterials: ["Kasturba Road", "Hudson Circle", "Richmond Road", "MG Road"],
    transitHub: "Cubbon Park (Purple Line)",
    notes:
      "Same CBD cluster as the Chinnaswamy fixture; concurrent road works on Hudson Circle reduce lane capacity.",
  },
  {
    id: "lalbagh-flower-show-2026",
    title: "Lalbagh Winter Flower Show",
    category: "cultural",
    venue: "Lalbagh Botanical Garden",
    locationName: "Lalbagh, Mavalli",
    zone: "South",
    lat: 12.9507,
    lng: 77.5848,
    startsAt: "2026-12-05T09:00:00+05:30",
    endsAt: "2026-12-05T18:00:00+05:30",
    expectedAttendance: 26_000,
    venueCapacity: 30_000,
    radiusM: 1_200,
    nearbyArterials: ["Lalbagh Road", "KH Road", "JC Road", "Double Road"],
    transitHub: "Lalbagh (Green Line)",
    notes:
      "Family footfall spread across the day; parking demand far exceeds in-garden capacity and spills onto Lalbagh Road.",
  },
  {
    id: "iskcon-festival-2026",
    title: "ISKCON Bengaluru · Grand Festival",
    category: "cultural",
    venue: "ISKCON Temple, Rajajinagar",
    locationName: "ISKCON Temple, Rajajinagar",
    zone: "West",
    lat: 13.0098,
    lng: 77.5511,
    startsAt: "2026-12-06T08:00:00+05:30",
    endsAt: "2026-12-06T21:00:00+05:30",
    expectedAttendance: 48_000,
    venueCapacity: 50_000,
    radiusM: 1_400,
    nearbyArterials: [
      "Chord Road",
      "West of Chord Road",
      "Mahakavi Kuvempu Road",
      "Dr Rajkumar Road",
    ],
    transitHub: "Rajajinagar (Green Line)",
    notes:
      "All-day darshan queue with three arrival peaks. Hilltop access road is a single choke point.",
  },
  {
    id: "biec-techsummit-2026",
    title: "TechSprint Summit · BIEC",
    category: "expo",
    venue: "Bangalore International Exhibition Centre",
    locationName: "BIEC, Tumkur Road",
    zone: "North",
    lat: 13.0625,
    lng: 77.4745,
    startsAt: "2026-12-12T10:00:00+05:30",
    endsAt: "2026-12-12T18:00:00+05:30",
    expectedAttendance: 17_000,
    venueCapacity: 20_000,
    radiusM: 1_500,
    nearbyArterials: ["Tumkur Road (NH-48)", "NICE Road", "Madavara Junction"],
    transitHub: "Madavara (Green Line)",
    notes:
      "Inbound wave hits Tumkur Road at 09:00–10:00; NICE Road is the only viable overflow corridor.",
  },
  {
    id: "whitefield-expo-2026",
    title: "Whitefield Startup Expo",
    category: "expo",
    venue: "ITPL Convention Centre",
    locationName: "ITPL, Whitefield",
    zone: "East",
    lat: 12.986,
    lng: 77.738,
    startsAt: "2026-12-13T10:00:00+05:30",
    endsAt: "2026-12-13T19:00:00+05:30",
    expectedAttendance: 11_000,
    venueCapacity: 15_000,
    radiusM: 900,
    nearbyArterials: ["Whitefield Main Road", "Old Madras Road", "ITPL Main Road"],
    transitHub: "Whitefield (Purple Line)",
    notes:
      "Weekend tech crowd with heavy cab share; pick-up/drop-off churn is the dominant bottleneck.",
  },
  {
    id: "prokabaddi-2026",
    title: "Pro Kabaddi League · Bengaluru Leg",
    category: "sport",
    venue: "Kanteerava Stadium",
    locationName: "Kanteerava Stadium, Kasturba Road",
    zone: "Central",
    lat: 12.9719,
    lng: 77.5936,
    startsAt: "2026-12-19T19:00:00+05:30",
    endsAt: "2026-12-19T22:00:00+05:30",
    expectedAttendance: 10_000,
    venueCapacity: 12_000,
    radiusM: 600,
    nearbyArterials: ["Kasturba Road", "Hudson Circle", "Richmond Road"],
    transitHub: "Cubbon Park (Purple Line)",
    notes: "Compact arena with fast egress; pressure is concentrated in a 25-minute window.",
  },
  {
    id: "jayanagar-bookfair-2026",
    title: "Jayanagar Book Fair",
    category: "cultural",
    venue: "Jayanagar 4th Block",
    locationName: "Jayanagar 4th Block, 11th Main",
    zone: "South",
    lat: 12.9299,
    lng: 77.5826,
    startsAt: "2026-12-20T10:00:00+05:30",
    endsAt: "2026-12-20T20:00:00+05:30",
    expectedAttendance: 4_500,
    venueCapacity: 6_000,
    radiusM: 500,
    nearbyArterials: ["Jayanagar 4th Block Main Road", "11th Main Road"],
    transitHub: "Jayanagar (Green Line)",
    notes:
      "Neighbourhood-scale footfall; impact stays local if on-street parking is enforced on 11th Main.",
  },
  {
    id: "yelahanka-lake-walk-2026",
    title: "Yelahanka Lake Community Walk",
    category: "cultural",
    venue: "Yelahanka Lake",
    locationName: "Yelahanka Lake, North",
    zone: "North",
    lat: 13.1007,
    lng: 77.5963,
    startsAt: "2026-12-06T06:30:00+05:30",
    endsAt: "2026-12-06T09:00:00+05:30",
    expectedAttendance: 1_200,
    venueCapacity: 2_500,
    radiusM: 300,
    nearbyArterials: ["Yelahanka Main Road"],
    transitHub: "Yelahanka (Green Line)",
    notes: "Neighbourhood walk with volunteer marshals; only local lane management required.",
  },
];

// ─── Deterministic risk score ─────────────────────────────────────────────────

const ZONE_WEIGHT: Record<EventZone, number> = {
  Central: 1,
  South: 0.97,
  Southeast: 0.96,
  East: 0.95,
  North: 0.93,
  West: 0.92,
};

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function riskLevelFor(score: number): RiskLevel {
  if (score >= 85) return "SEVERE";
  if (score >= 65) return "HIGH";
  if (score >= 45) return "MODERATE";
  return "LOW";
}

/**
 * Composite 0–100 risk score used to rank events before the LLM report lands.
 * Risk is multiplicative — network exposure scaled by zone sensitivity:
 *   60% attendance scale · 25% venue utilisation · 15% road-network exposure.
 * CBD events amplify more corridors than edge-of-city venues.
 */
export function eventRiskScore(event: CityEvent): { score: number; level: RiskLevel } {
  const attendanceFactor = clamp(
    Math.log10(Math.max(1, event.expectedAttendance)) / Math.log10(100_000),
    0,
    1.35,
  );
  const utilisation = clamp(
    event.expectedAttendance / Math.max(1, event.venueCapacity),
    0.25,
    1.15,
  );
  const roadPressure = clamp(event.nearbyArterials.length / 5, 0.2, 1);
  const zoneWeight = ZONE_WEIGHT[event.zone] ?? 0.95;

  const raw = (0.6 * attendanceFactor + 0.25 * utilisation + 0.15 * roadPressure) * zoneWeight;
  const score = Math.round(clamp(raw * 100, 0, 100));
  return { score, level: riskLevelFor(score) };
}

export function rankEvents(
  events: CityEvent[] = CITY_EVENTS,
): { event: CityEvent; score: number; level: RiskLevel }[] {
  return events
    .map((event) => {
      const risk = eventRiskScore(event);
      return { event, score: risk.score, level: risk.level };
    })
    .sort((a, b) => b.score - a.score || a.event.startsAt.localeCompare(b.event.startsAt));
}

// ─── Impact report shape (shared by the LLM server fn and the fallback) ───────

export type EventInflowPhase = { phase: string; pct: number; people: number };

export type EventCorridorImpact = { corridor: string; addedMin: number; note: string };

export type EventImpact = {
  source: "model" | "agent";
  crowd: {
    expected: number;
    peakConcurrent: number;
    gatePressure: string;
    inflow: EventInflowPhase[];
  };
  traffic: {
    addedPcuPerHour: number;
    parkingDemand: number;
    corridors: EventCorridorImpact[];
    closures: string[];
  };
  transit: {
    metroSurge: string;
    bmtc: string;
  };
  risk: {
    score: number;
    level: RiskLevel;
    concerns: string[];
    actions: string[];
  };
  summary: string;
};

const numberFormat = new Intl.NumberFormat("en-IN");

export const formatCount = (value: number): string => numberFormat.format(Math.round(value));

/**
 * Deterministic impact estimate. Runs client-side for instant feedback and
 * server-side as the fallback when the NVIDIA API is unavailable.
 */
export function estimateEventImpact(event: CityEvent): EventImpact {
  const { score, level } = eventRiskScore(event);
  const expected = Math.max(0, Math.round(event.expectedAttendance));
  const peakConcurrent = Math.round(expected * 0.72);

  const inflow: EventInflowPhase[] = [
    { phase: "T-3h", pct: 18 },
    { phase: "T-2h", pct: 31 },
    { phase: "T-1h", pct: 36 },
    { phase: "T-0", pct: 15 },
  ].map(({ phase, pct }) => ({ phase, pct, people: Math.round((expected * pct) / 100) }));

  const vehicles = Math.round(expected * 0.32);
  const addedPcuPerHour = Math.round((vehicles * 1.6) / 2.5);
  const parkingDemand = Math.round(vehicles * 0.85);

  const corridors: EventCorridorImpact[] = event.nearbyArterials.slice(0, 4).map((corridor, i) => {
    const addedMin = Math.max(3, Math.round(score / 6) - i * 3);
    const note =
      i === 0
        ? "Primary arrival corridor · signal saturation at the venue gate"
        : i === 1
          ? "Spillover queue from gate backlog"
          : "Secondary pressure from diverted demand";
    return { corridor, addedMin, note };
  });

  const closures: string[] =
    event.category === "marathon"
      ? [`Rolling closures on ${event.nearbyArterials.slice(0, 3).join(", ")} from 04:00 to 11:00.`]
      : [];

  const transit = {
    metroSurge: `${formatCount(expected * 0.28)} extra entries/h at ${event.transitHub}.`,
    bmtc: `${formatCount(expected * 0.12)} additional BMTC trips staged on ${event.nearbyArterials[0] ?? "the primary corridor"}.`,
  };

  const primaryCorridor = corridors[0]?.corridor ?? "the primary corridor";
  const primaryDelay = corridors[0]?.addedMin ?? 8;

  const concerns = [
    `Gate throughput at ${event.venue} peaks during the T-1h arrival wave.`,
    `Parking spillover of ~${formatCount(parkingDemand)} vehicles onto ${event.nearbyArterials[0] ?? "surrounding roads"}.`,
    `${level} corridor risk around ${event.zone} with +${primaryDelay} min on ${primaryCorridor}.`,
  ];

  const actions = [
    "Stagger gate openings 20 minutes apart and publish entry windows 48h ahead.",
    `Pre-position traffic wardens on ${event.nearbyArterials.slice(0, 2).join(" and ") || primaryCorridor} from T-2h.`,
    `Push a multimodal advisory (Metro + BMTC) to ${formatCount(expected * 0.4)} ticket holders.`,
  ];

  const gatePressure = `Peak gate load at T-1h: ~${formatCount((expected * 0.36) / 60)} people/min across all gates.`;

  return {
    source: "model",
    crowd: { expected, peakConcurrent, gatePressure, inflow },
    traffic: { addedPcuPerHour, parkingDemand, corridors, closures },
    transit,
    risk: { score, level, concerns, actions },
    summary: `${formatCount(expected)} expected at ${event.venue}. ${level} network risk — +${primaryDelay} min on ${primaryCorridor} and ${formatCount(addedPcuPerHour)} extra PCU/h.`,
  };
}
