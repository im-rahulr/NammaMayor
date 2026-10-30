// Deterministic, unit-testable model for the ORR Agara closure scenario.
// Volumes are assumptions (PCU/h); geometry & free-flow come from OSRM.
// Keep every tunable here so the UI stays a thin renderer.

export type VehicleClass = {
  id: string;
  label: string;
  pcuPerVehicle: number;
  volumePerHour: number; // PCU/h
  occupancy: number; // persons/vehicle
  action: string;
  corridor: string; // diversion id
};

export type Diversion = {
  id: string;
  label: string;
  via: string;
  km: number; // OSRM
  freeFlowMin: number; // OSRM
  peakMin: number; // modelled at peak
  share: number; // 0..1 of diverted demand
  colorVar: string;
};

export const BASELINE = {
  road: "Outer Ring Road EB · Agara",
  from: "Silk Board Junction",
  to: "Bellandur",
  km: 6.29,
  freeFlowMin: 8.3,
  peakMin: 20.0,
  lanes: 3,
  capacityPcuPerHourPerLane: 1800,
  demandPcuPerHour: 6300,
  peakSpeedKmh: 19,
};

export const DIVERSIONS: Diversion[] = [
  {
    id: "A",
    label: "via HSR 27th Main",
    via: "HSR Layout",
    km: 8.07,
    freeFlowMin: 12.1,
    peakMin: 25.5,
    share: 0.35,
    colorVar: "--success",
  },
  {
    id: "B",
    label: "via Sarjapur Rd",
    via: "Sarjapur Road",
    km: 11.69,
    freeFlowMin: 17.7,
    peakMin: 31.9,
    share: 0.35,
    colorVar: "--primary",
  },
  {
    id: "C",
    label: "via Koramangala",
    via: "Koramangala 80 Ft Rd",
    km: 11.62,
    freeFlowMin: 16.1,
    peakMin: 34.9,
    share: 0.2,
    colorVar: "--accent",
  },
  {
    id: "D",
    label: "via BTM / Hosur Rd",
    via: "BTM Layout",
    km: 17.24,
    freeFlowMin: 24.9,
    peakMin: 47.0,
    share: 0.1,
    colorVar: "--muted-foreground",
  },
];

export const VEHICLE_CLASSES: VehicleClass[] = [
  {
    id: "car",
    label: "Private cars",
    pcuPerVehicle: 1,
    volumePerHour: 4000,
    occupancy: 1.4,
    action: "Diverted to A/B/C by destination",
    corridor: "A",
  },
  {
    id: "tw",
    label: "Two-wheelers",
    pcuPerVehicle: 0.5,
    volumePerHour: 2700,
    occupancy: 1.1,
    action: "Diverted to A/B (local)",
    corridor: "A",
  },
  {
    id: "bus",
    label: "BMTC buses (500-series, 342F, KIAS-9)",
    pcuPerVehicle: 3,
    volumePerHour: 210,
    occupancy: 45,
    action: "44 re-routed, 26 curtailed, 8 extras",
    corridor: "B",
  },
  {
    id: "auto",
    label: "Autos",
    pcuPerVehicle: 0.5,
    volumePerHour: 900,
    occupancy: 1.2,
    action: "Diverted to A/B (local)",
    corridor: "A",
  },
  {
    id: "truck",
    label: "LCV / trucks",
    pcuPerVehicle: 2,
    volumePerHour: 290,
    occupancy: 1.1,
    action: "Banned 07:00–11:00; hold at yard",
    corridor: "D",
  },
  {
    id: "amb",
    label: "Ambulances",
    pcuPerVehicle: 1,
    volumePerHour: 3,
    occupancy: 2,
    action: "Priority corridor via 27th Main, +2 min only",
    corridor: "A",
  },
];

export function capacityPcuPerHour(lanesOpen: number): number {
  return lanesOpen * BASELINE.capacityPcuPerHourPerLane;
}

export function bprMinutes(freeFlow: number, vc: number, alpha = 0.9, beta = 4): number {
  return freeFlow * (1 + alpha * Math.pow(vc, beta));
}

export function queueMeters(demandPcu: number, capacityPcu: number, avgDelayMin: number): number {
  // vehicles in queue * ~2.35 m/PCU (mixed traffic)
  const inQueue = (demandPcu - capacityPcu) * (avgDelayMin / 60);
  return Math.max(0, Math.round(inQueue * 2.35));
}

export function personHours(demandPcu: number, avgDelayMin: number, personsPerPcu: number): number {
  const persons = demandPcu * personsPerPcu;
  return (persons * avgDelayMin) / 60;
}

export function avgDivertedDelayMin(): number {
  return DIVERSIONS.reduce((s, d) => s + (d.peakMin - BASELINE.peakMin) * d.share, 0);
}

export function avgTripAfterMin(): number {
  return BASELINE.peakMin + avgDivertedDelayMin();
}

export function nightDemandPcuPerHour(): number {
  // night demand is ~15% of peak
  return Math.round(BASELINE.demandPcuPerHour * 0.15);
}

export function personsPerPcu(): number {
  const pcu = VEHICLE_CLASSES.reduce((s, c) => s + c.volumePerHour, 0);
  const persons = VEHICLE_CLASSES.reduce(
    (s, c) => s + (c.volumePerHour / c.pcuPerVehicle) * c.occupancy,
    0,
  );
  return persons / pcu;
}

export type Impact = {
  baselineTripMin: number;
  divertedTripMin: number;
  addedMin: number;
  queueM: number;
  personHoursPerHour: number;
  nightPersonHoursPerHour: number;
  personHoursSavedByNight: number;
  p85Baseline: number;
  p85Diverted: number;
  throughputPcuPerHour: number;
  divertedPcuPerHour: number;
};

export function computeImpact(): Impact {
  const added = avgDivertedDelayMin();
  const diverted = BASELINE.peakMin + added;
  const cap = capacityPcuPerHour(0); // full closure
  const qm = queueMeters(BASELINE.demandPcuPerHour, cap, added === 0 ? 1 : added);
  const ppcu = personsPerPcu();
  const ph = personHours(BASELINE.demandPcuPerHour, added, ppcu);
  const nightDemand = nightDemandPcuPerHour();
  const nightAdded = added * 0.12; // night: much lighter queues
  const nightPh = personHours(nightDemand, nightAdded, ppcu);
  return {
    baselineTripMin: BASELINE.peakMin,
    divertedTripMin: +diverted.toFixed(1),
    addedMin: +added.toFixed(1),
    queueM: qm,
    personHoursPerHour: Math.round(ph),
    nightPersonHoursPerHour: Math.round(nightPh),
    personHoursSavedByNight: Math.round(ph - nightPh),
    p85Baseline: 27,
    p85Diverted: 44,
    throughputPcuPerHour: cap,
    divertedPcuPerHour: BASELINE.demandPcuPerHour,
  };
}

export function computeDynamicRoadImpact(
  baselineTripMin: number,
  divertedTripMin: number,
  roadName = "Closed Corridor",
): Impact {
  const added = Math.max(0, divertedTripMin - baselineTripMin);
  const cap = capacityPcuPerHour(0);
  const demand = 5800;
  const qm = queueMeters(demand, cap, added === 0 ? 1 : added);
  const ppcu = personsPerPcu();
  const ph = personHours(demand, added, ppcu);
  const nightDemand = Math.round(demand * 0.15);
  const nightAdded = added * 0.12;
  const nightPh = personHours(nightDemand, nightAdded, ppcu);
  return {
    baselineTripMin: +baselineTripMin.toFixed(1),
    divertedTripMin: +divertedTripMin.toFixed(1),
    addedMin: +added.toFixed(1),
    queueM: qm,
    personHoursPerHour: Math.round(ph),
    nightPersonHoursPerHour: Math.round(nightPh),
    personHoursSavedByNight: Math.round(ph - nightPh),
    p85Baseline: Math.round(baselineTripMin * 1.35),
    p85Diverted: Math.round(divertedTripMin * 1.4),
    throughputPcuPerHour: cap,
    divertedPcuPerHour: demand,
  };
}
