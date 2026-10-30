// Hand-built Bengaluru junction graph for Dijkstra-based detour planning.
// Weights are modelled travel minutes (peak). Geometries map realistic
// Bengaluru road curvatures between key junctions.

export type Node = { id: string; name: string; lat: number; lng: number };
export type Edge = {
  id: string;
  from: string;
  to: string;
  minutes: number;
  km: number;
  road: string;
};

export const NODES: Node[] = [
  { id: "SILK", name: "Silk Board Junction", lat: 12.9177, lng: 77.6238 },
  { id: "AGARA", name: "Agara Junction", lat: 12.9235, lng: 77.6431 },
  { id: "HSR27", name: "HSR 27th Main", lat: 12.9142, lng: 77.6529 },
  { id: "HSR", name: "HSR Layout", lat: 12.9116, lng: 77.6474 },
  { id: "SARJ", name: "Sarjapur Road", lat: 12.9105, lng: 77.673 },
  { id: "BELL", name: "Bellandur", lat: 12.926, lng: 77.6762 },
  { id: "KORA", name: "Koramangala", lat: 12.9352, lng: 77.6245 },
  { id: "BTM", name: "BTM Layout", lat: 12.9166, lng: 77.6101 },
  { id: "MADI", name: "Madiwala", lat: 12.9225, lng: 77.6155 },
  { id: "HOSUR", name: "Hosur Rd", lat: 12.905, lng: 77.62 },
  { id: "ELEC", name: "Electronic City", lat: 12.845, lng: 77.66 },
];

export const EDGES: Edge[] = [
  { id: "E1", from: "SILK", to: "AGARA", minutes: 5.6, km: 2.91, road: "Outer Ring Road (ORR EB)" },
  { id: "E2", from: "AGARA", to: "BELL", minutes: 5.5, km: 4.53, road: "Outer Ring Road (ORR EB)" },
  { id: "E3", from: "SILK", to: "HSR", minutes: 4.5, km: 2.4, road: "HSR Main Rd" },
  { id: "E4", from: "HSR", to: "HSR27", minutes: 2.0, km: 1.1, road: "27th Main" },
  { id: "E5", from: "HSR27", to: "AGARA", minutes: 3.0, km: 1.6, road: "Agara Link" },
  { id: "E6", from: "HSR27", to: "BELL", minutes: 6.0, km: 3.2, road: "HSR-Bellandur" },
  { id: "E7", from: "SILK", to: "SARJ", minutes: 6.0, km: 4.0, road: "Sarjapur Rd (via HSR)" },
  { id: "E8", from: "SARJ", to: "BELL", minutes: 4.0, km: 2.5, road: "Sarjapur Rd East" },
  { id: "E9", from: "SILK", to: "KORA", minutes: 4.0, km: 2.2, road: "Koramangala Rd" },
  { id: "E10", from: "KORA", to: "BELL", minutes: 12.0, km: 7.0, road: "Koramangala-Bellandur" },
  { id: "E11", from: "SILK", to: "BTM", minutes: 3.0, km: 1.8, road: "BTM Link" },
  { id: "E12", from: "BTM", to: "BELL", minutes: 22.0, km: 15.0, road: "via BTM" },
  { id: "E13", from: "SILK", to: "MADI", minutes: 2.5, km: 1.4, road: "Madiwala Rd" },
  { id: "E14", from: "MADI", to: "HOSUR", minutes: 3.0, km: 1.8, road: "Hosur Rd" },
  { id: "E15", from: "HOSUR", to: "ELEC", minutes: 18.0, km: 14.0, road: "Hosur Elevated Exp" },
  { id: "E16", from: "AGARA", to: "HSR", minutes: 3.5, km: 1.9, road: "Agara-HSR Link" },
];

// make undirected
export const ALL_EDGES: Edge[] = EDGES.flatMap((e) => [
  e,
  { ...e, id: e.id + "r", from: e.to, to: e.from },
]);

export const NODE_MAP = new Map<string, Node>(NODES.map((n) => [n.id, n]));
export const getNode = (id: string): Node | undefined => NODE_MAP.get(id);

export const EDGE_GEOMETRY: Record<string, [number, number][]> = {
  E1: [
    [12.9177, 77.6238],
    [12.92, 77.629],
    [12.922, 77.636],
    [12.9235, 77.6431],
  ],
  E2: [
    [12.9235, 77.6431],
    [12.9248, 77.654],
    [12.9255, 77.665],
    [12.926, 77.6762],
  ],
  E3: [
    [12.9177, 77.6238],
    [12.9145, 77.635],
    [12.9116, 77.6474],
  ],
  E4: [
    [12.9116, 77.6474],
    [12.9128, 77.65],
    [12.9142, 77.6529],
  ],
  E5: [
    [12.9142, 77.6529],
    [12.919, 77.648],
    [12.9235, 77.6431],
  ],
  E6: [
    [12.9142, 77.6529],
    [12.92, 77.665],
    [12.926, 77.6762],
  ],
  E7: [
    [12.9177, 77.6238],
    [12.913, 77.65],
    [12.9105, 77.673],
  ],
  E8: [
    [12.9105, 77.673],
    [12.918, 77.6745],
    [12.926, 77.6762],
  ],
  E9: [
    [12.9177, 77.6238],
    [12.926, 77.624],
    [12.9352, 77.6245],
  ],
  E10: [
    [12.9352, 77.6245],
    [12.933, 77.65],
    [12.926, 77.6762],
  ],
  E11: [
    [12.9177, 77.6238],
    [12.917, 77.617],
    [12.9166, 77.6101],
  ],
  E12: [
    [12.9166, 77.6101],
    [12.905, 77.64],
    [12.926, 77.6762],
  ],
  E13: [
    [12.9177, 77.6238],
    [12.92, 77.619],
    [12.9225, 77.6155],
  ],
  E14: [
    [12.9225, 77.6155],
    [12.914, 77.618],
    [12.905, 77.62],
  ],
  E15: [
    [12.905, 77.62],
    [12.875, 77.64],
    [12.845, 77.66],
  ],
  E16: [
    [12.9235, 77.6431],
    [12.9175, 77.645],
    [12.9116, 77.6474],
  ],
};

export function getEdgeCoords(edgeId: string): [number, number][] {
  const isRev = edgeId.endsWith("r");
  const baseId = isRev ? edgeId.slice(0, -1) : edgeId;
  const geom = EDGE_GEOMETRY[baseId];
  if (geom) {
    return isRev ? [...geom].reverse() : [...geom];
  }
  const edge = ALL_EDGES.find((e) => e.id === edgeId);
  if (!edge) return [];
  const fromNode = getNode(edge.from);
  const toNode = getNode(edge.to);
  if (!fromNode || !toNode) return [];
  return [
    [fromNode.lat, fromNode.lng],
    [toNode.lat, toNode.lng],
  ];
}

function distToSegment(
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

export function findNearestEdge(
  lat: number,
  lng: number,
  maxDistanceM = 800,
): { edge: Edge; distanceM: number } | null {
  let best: { edge: Edge; distanceM: number } | null = null;
  for (const edge of EDGES) {
    const coords = getEdgeCoords(edge.id);
    for (let i = 0; i < coords.length - 1; i++) {
      const d = distToSegment({ lat, lng }, coords[i]!, coords[i + 1]!);
      if (!best || d < best.distanceM) {
        best = { edge, distanceM: d };
      }
    }
  }
  if (best && best.distanceM <= maxDistanceM) {
    return best;
  }
  return null;
}

export function getFullRoadLabel(edge: Edge): string {
  const fromName = getNode(edge.from)?.name ?? edge.from;
  const toName = getNode(edge.to)?.name ?? edge.to;
  return `${edge.road} (${fromName} ↔ ${toName})`;
}

export type CityLocation = {
  id: string;
  name: string;
  zone: "Central" | "South" | "Southeast" | "East" | "North" | "West";
  lat: number;
  lng: number;
};

export const CITY_LOCATIONS: CityLocation[] = [
  // Central Bangalore
  {
    id: "MAJESTIC",
    name: "Majestic (Kempegowda Bus Station)",
    zone: "Central",
    lat: 12.9767,
    lng: 77.5713,
  },
  { id: "MGROAD", name: "MG Road / Brigade Road", zone: "Central", lat: 12.9756, lng: 77.6066 },
  {
    id: "VIDHANA",
    name: "Vidhana Soudha / High Court",
    zone: "Central",
    lat: 12.9797,
    lng: 77.5908,
  },
  {
    id: "SHANTHI",
    name: "Shanthi Nagar / Richmond Town",
    zone: "Central",
    lat: 12.961,
    lng: 77.601,
  },
  {
    id: "SHIVAJI",
    name: "Shivajinagar / Commercial St",
    zone: "Central",
    lat: 12.985,
    lng: 77.605,
  },

  // South Bangalore
  { id: "SILK", name: "Silk Board Junction", zone: "South", lat: 12.9177, lng: 77.6238 },
  { id: "KORA", name: "Koramangala 80ft Road", zone: "South", lat: 12.9352, lng: 77.6245 },
  { id: "HSR", name: "HSR Layout (Sector 1)", zone: "South", lat: 12.9116, lng: 77.6474 },
  { id: "BTM", name: "BTM Layout", zone: "South", lat: 12.9166, lng: 77.6101 },
  { id: "JAYANAGAR", name: "Jayanagar 4th Block", zone: "South", lat: 12.9299, lng: 77.5826 },
  { id: "JPNAGAR", name: "JP Nagar (Sarakki)", zone: "South", lat: 12.9063, lng: 77.5857 },
  { id: "BANASHANKARI", name: "Banashankari TTMC", zone: "South", lat: 12.9255, lng: 77.5468 },
  { id: "ELEC1", name: "Electronic City Phase 1", zone: "South", lat: 12.845, lng: 77.66 },
  { id: "ELEC2", name: "Electronic City Phase 2", zone: "South", lat: 12.839, lng: 77.678 },
  { id: "BANNER", name: "Bannerghatta Road (IIM-B)", zone: "South", lat: 12.895, lng: 77.598 },
  { id: "BOMMAN", name: "Bommanahalli", zone: "South", lat: 12.903, lng: 77.624 },
  { id: "MADI", name: "Madiwala Junction", zone: "South", lat: 12.9225, lng: 77.6155 },

  // Southeast / Ring Road
  { id: "AGARA", name: "Agara Junction", zone: "Southeast", lat: 12.9235, lng: 77.6431 },
  { id: "HSR27", name: "HSR 27th Main", zone: "Southeast", lat: 12.9142, lng: 77.6529 },
  { id: "BELL", name: "Bellandur (EcoSpace)", zone: "Southeast", lat: 12.926, lng: 77.6762 },
  { id: "SARJ", name: "Sarjapur Road (Wipro)", zone: "Southeast", lat: 12.9105, lng: 77.673 },
  { id: "KADUBEESAN", name: "Kadubeesanahalli (ORR)", zone: "Southeast", lat: 12.936, lng: 77.692 },
  { id: "DEVARABISAN", name: "Devarabisanahalli", zone: "Southeast", lat: 12.93, lng: 77.688 },

  // East Bangalore
  { id: "INDIRA", name: "Indiranagar (100 Feet Rd)", zone: "East", lat: 12.9784, lng: 77.6408 },
  { id: "DOMLUR", name: "Domlur / Old Airport Rd", zone: "East", lat: 12.9609, lng: 77.6387 },
  { id: "MARATH", name: "Marathahalli Bridge", zone: "East", lat: 12.956, lng: 77.701 },
  { id: "WHITEFIELD", name: "Whitefield (ITPL)", zone: "East", lat: 12.986, lng: 77.738 },
  { id: "WHITEFIELD_MAIN", name: "Whitefield Main Road", zone: "East", lat: 12.9698, lng: 77.7499 },
  { id: "KRPURAM", name: "KR Puram / Tin Factory", zone: "East", lat: 12.998, lng: 77.682 },
  { id: "MAHADEVA", name: "Mahadevapura", zone: "East", lat: 12.988, lng: 77.696 },
  { id: "VARTHUR", name: "Varthur Lake Junction", zone: "East", lat: 12.94, lng: 77.747 },
  { id: "HAL", name: "HAL Old Airport Road", zone: "East", lat: 12.961, lng: 77.665 },

  // North Bangalore
  { id: "HEBBAL", name: "Hebbal Flyover", zone: "North", lat: 13.0358, lng: 77.597 },
  { id: "MANYATA", name: "Manyata Tech Park (Nagavara)", zone: "North", lat: 13.045, lng: 77.62 },
  { id: "RTNAGAR", name: "RT Nagar Post Office", zone: "North", lat: 13.018, lng: 77.594 },
  { id: "YESHWANTH", name: "Yeshwanthpur Railway Station", zone: "North", lat: 13.028, lng: 77.54 },
  { id: "MALLESH", name: "Malleshwaram (8th Cross)", zone: "North", lat: 13.003, lng: 77.57 },
  { id: "YELAHANKA", name: "Yelahanka Old Town", zone: "North", lat: 13.1007, lng: 77.5963 },
  { id: "JAKKUR", name: "Jakkur Aerodrome", zone: "North", lat: 13.078, lng: 77.607 },
  {
    id: "BLR_AIRPORT",
    name: "Kempegowda Intl Airport (BLR)",
    zone: "North",
    lat: 13.1986,
    lng: 77.7066,
  },

  // West Bangalore
  { id: "RAJAJI", name: "Rajajinagar (1st Block)", zone: "West", lat: 12.99, lng: 77.553 },
  { id: "VIJAYA", name: "Vijayanagar TTMC", zone: "West", lat: 12.968, lng: 77.535 },
  { id: "BASAVANA", name: "Basavanagudi (Gandhi Bazaar)", zone: "West", lat: 12.942, lng: 77.574 },
  { id: "MYSORE_RD", name: "Nayandahalli / Mysore Road", zone: "West", lat: 12.945, lng: 77.518 },
  { id: "KENGERI", name: "Kengeri Satellite Town", zone: "West", lat: 12.913, lng: 77.483 },
];

export function findNearestLocation(lat: number, lng: number): CityLocation {
  let best = CITY_LOCATIONS[0]!;
  let bestDist = Infinity;
  for (const loc of CITY_LOCATIONS) {
    const d = Math.hypot(loc.lat - lat, loc.lng - lng);
    if (d < bestDist) {
      bestDist = d;
      best = loc;
    }
  }
  return best;
}
