// Emergency public alerts — WhatsApp advisories sent to people in and around an
// incident, not to responding officers.
//
// Delivery uses wa.me deep links rather than a paid WhatsApp API: the app builds
// the public advisory and opens WhatsApp (browser or desktop client) with the
// message pre-filled for each number, so no credentials or Meta business account
// are needed. Browsers allow one popup per user gesture, so a marked incident
// auto-opens the first number and queues the rest in the alert panel for
// one-tap sending.

export type IncidentType = "flood" | "gas" | "accident" | "roadblock" | "fire" | "medical";

/** A WhatsApp number to notify. */
export type AlertContact = {
  id: string;
  name: string;
  /** E.164 digits without a leading "+", e.g. "918618140050". */
  phone: string;
};

/**
 * Default numbers supplied by the operator. Stored as 10-digit Indian mobiles
 * and normalised to +91 so they can be re-entered freely.
 */
export const DEFAULT_ALERT_CONTACTS: AlertContact[] = [
  { id: "contact-1", name: "Contact 1", phone: normalizePhone("8618140050")! },
  { id: "contact-2", name: "Contact 2", phone: normalizePhone("9739904620")! },
  { id: "contact-3", name: "Contact 3", phone: normalizePhone("7349321463")! },
];

export const ALERT_CONTACTS_STORAGE_KEY = "nammamayor.alertContacts.v1";

const EMERGENCY_HELPLINES = "112 Police · 101 Fire · 108 Ambulance · 1182 BBMP";

/** How long the COMMS agent holds the broadcast before releasing it to WhatsApp. */
export const AI_BROADCAST_DELAY_MS = 5_000;

/** The subset of a marked incident a public alert is built from. */
export type IncidentAlertInput = {
  type: IncidentType;
  icon: string;
  typeName: string;
  title: string;
  locationName: string;
  lat: number;
  lng: number;
  radiusM: number;
  severity: "CRITICAL" | "HIGH" | "ELEVATED";
  timestamp: string;
  description: string;
};

/** What a person at or near the incident should actually do. */
export function publicAdvisoryFor(type: IncidentType): { avoid: string; do: string } {
  switch (type) {
    case "flood":
      return {
        avoid: "waterlogged roads and underpasses",
        do: "Do not drive or wade through floodwater. Move to higher ground and stay off the carriageway.",
      };
    case "gas":
      return {
        avoid: "the leak zone, downwind of it",
        do: "Shelter in place, close windows, and switch off flames and sparks. Evacuate only when instructed.",
      };
    case "accident":
      return {
        avoid: "the collision site",
        do: "Keep the carriageway clear for responders. Do not stop to film; use an alternate route.",
      };
    case "roadblock":
      return {
        avoid: "the closed stretch and its barricades",
        do: "Follow the signed diversion. Do not cross barricades or drive on the shoulder.",
      };
    case "fire":
      return {
        avoid: "smoke and the building perimeter",
        do: "Move upwind, use stairs never lifts, and keep access roads free for fire tenders.",
      };
    case "medical":
      return {
        avoid: "the casualty site and its approaches",
        do: "Keep the emergency lane free for ambulances and do not crowd the scene.",
      };
  }
}

/** Strips formatting and resolves Indian mobiles to +91 E.164 digits. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  const withoutIntlPrefix = digits.startsWith("00") ? digits.slice(2) : digits;

  if (/^[6-9]\d{9}$/.test(withoutIntlPrefix)) return `91${withoutIntlPrefix}`;
  if (/^0[6-9]\d{9}$/.test(withoutIntlPrefix)) return `91${withoutIntlPrefix.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(withoutIntlPrefix)) return withoutIntlPrefix;
  // Anything else is assumed to already carry a country code.
  return withoutIntlPrefix.length >= 8 && withoutIntlPrefix.length <= 15 ? withoutIntlPrefix : null;
}

export function formatPhoneForDisplay(phone: string): string {
  return phone.startsWith("91") && phone.length === 12
    ? `+91 ${phone.slice(2, 7)} ${phone.slice(7)}`
    : `+${phone}`;
}

const mapUrl = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`;

/** The public advisory sent to every number on the list. */
export function buildAlertMessage(incident: IncidentAlertInput): string {
  const advisory = publicAdvisoryFor(incident.type);
  return [
    `🚨 *PUBLIC SAFETY ALERT — Bengaluru*`,
    ``,
    `${incident.icon} *${incident.typeName}* at ${incident.locationName}`,
    `Severity ${incident.severity} · reported ${incident.timestamp} IST`,
    ``,
    `⚠️ *AVOID TRAVELLING* through ${advisory.avoid}.`,
    `Cordon: ${incident.radiusM} m radius. Expect delays and diversions until the all-clear.`,
    ``,
    `${advisory.do}`,
    ``,
    `What happened: ${incident.description}`,
    `Pin: ${mapUrl(incident.lat, incident.lng)}`,
    ``,
    `Emergency: ${EMERGENCY_HELPLINES}`,
    ``,
    `_Automated alert from the NammaMayor OS crisis command centre. Do not reply._`,
  ].join("\n");
}

export function whatsappUrl(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

/** Single-tab broadcast: WhatsApp's own recipient picker handles the fan-out. */
export function whatsappBroadcastUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * Opens a wa.me tab. Returns false when the browser blocked the popup, which is
 * the signal for the UI to fall back to a visible "Send" button.
 */
export function openWhatsAppTab(url: string): boolean {
  if (typeof window === "undefined") return false;
  const tab = window.open(url, "_blank", "noopener,noreferrer");
  return tab !== null;
}

export type AlertDispatch = {
  message: string;
  /** The COMMS agent is counting down before the numbers receive anything. */
  stage: "preparing" | "sent" | "blocked" | "cancelled";
  /** Number whose WhatsApp window the AI opened. */
  opened: AlertContact | null;
  /** Numbers that still need one tap in the alert panel. */
  queued: AlertContact[];
  /** Seconds left while preparing, for the panel's own countdown. */
  secondsLeft: number;
};

/**
 * Fires the public alert for a marked incident the way the COMMS agent does it:
 * a broadcast window opens immediately (only possible inside the operator's
 * click) showing a countdown, and the WhatsApp advisory is released to the first
 * number once the delay is up. The remaining numbers stay queued in the panel,
 * since a browser only ever permits one window per gesture.
 *
 * Returns the cancel function — used when the operator clears the incident
 * before the broadcast goes out.
 */
export function schedulePublicAlert(
  incident: IncidentAlertInput,
  contacts: AlertContact[],
  onUpdate: (dispatch: AlertDispatch) => void,
  delayMs = AI_BROADCAST_DELAY_MS,
): () => void {
  const message = buildAlertMessage(incident);
  const [first, ...rest] = contacts;

  if (!first) {
    onUpdate({ message, stage: "blocked", opened: null, queued: [], secondsLeft: 0 });
    return () => {};
  }

  const popup = openBroadcastWindow();
  if (!popup) {
    onUpdate({
      message,
      stage: "blocked",
      opened: null,
      queued: contacts,
      secondsLeft: 0,
    });
    return () => {};
  }

  let secondsLeft = Math.round(delayMs / 1000);
  onUpdate({
    message,
    stage: "preparing",
    opened: first,
    queued: rest,
    secondsLeft,
  });

  const repaint = () => paintBroadcastCountdown(popup, incident, secondsLeft);
  repaint();
  const ticker = window.setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      window.clearInterval(ticker);
      popup.location.href = whatsappUrl(first.phone, message);
      onUpdate({
        message,
        stage: "sent",
        opened: first,
        queued: rest,
        secondsLeft: 0,
      });
      return;
    }
    repaint();
    onUpdate({ message, stage: "preparing", opened: first, queued: rest, secondsLeft });
  }, 1000);

  return () => {
    window.clearInterval(ticker);
    popup.close();
    onUpdate({
      message,
      stage: "cancelled",
      opened: first,
      queued: rest,
      secondsLeft: 0,
    });
  };
}

/** Opens the pending-broadcast window. Must run inside the operator's click. */
function openBroadcastWindow(): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(
    "about:blank",
    "nammamayor-public-alert",
    "width=440,height=620,menubar=no,toolbar=no,location=no,status=no",
  );
}

/** The "AI is sending" screen shown while the countdown runs. */
function paintBroadcastCountdown(
  popup: Window,
  incident: IncidentAlertInput,
  secondsLeft: number,
): void {
  const doc = popup.document;
  if (!doc.body) return;

  doc.title = "NammaMayor OS — public alert";
  const text = (value: string) => {
    const p = doc.createElement("p");
    p.textContent = value;
    p.style.cssText = "margin:6px 0;font:12px/1.5 ui-monospace,monospace;color:#94a3b8";
    return p;
  };

  doc.body.textContent = "";
  doc.body.style.cssText =
    "margin:0;padding:20px;background:#0b1120;color:#e2e8f0;font-family:ui-monospace,monospace";
  doc.body.append(
    (() => {
      const h = doc.createElement("h1");
      h.textContent = "🤖 COMMS AGENT — PREPARING BROADCAST";
      h.style.cssText = "margin:0 0 12px;font-size:13px;letter-spacing:.1em;color:#f87171";
      return h;
    })(),
    text(`${incident.icon} ${incident.typeName} at ${incident.locationName}`),
    text(`Severity ${incident.severity} · ${incident.radiusM} m cordon`),
    (() => {
      const strong = doc.createElement("strong");
      strong.textContent = "⚠️ AVOID TRAVELLING — this advisory goes out on WhatsApp";
      strong.style.cssText = "display:block;margin:12px 0;font-size:12px;color:#fbbf24";
      return strong;
    })(),
    (() => {
      const big = doc.createElement("div");
      big.textContent = secondsLeft > 0 ? `${secondsLeft}s` : "SENT";
      big.style.cssText =
        "margin:16px 0;font-size:44px;font-weight:700;color:#f87171;text-align:center";
      return big;
    })(),
    text("Drafting the public message now. Do not close this window."),
  );
}

export function loadAlertContacts(): AlertContact[] {
  if (typeof window === "undefined") return DEFAULT_ALERT_CONTACTS;
  try {
    const raw = window.localStorage.getItem(ALERT_CONTACTS_STORAGE_KEY);
    if (!raw) return DEFAULT_ALERT_CONTACTS;
    const parsed = JSON.parse(raw);
    return sanitizeContacts(parsed) ?? DEFAULT_ALERT_CONTACTS;
  } catch {
    return DEFAULT_ALERT_CONTACTS;
  }
}

export function saveAlertContacts(contacts: AlertContact[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALERT_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  } catch {
    // Private-mode or quota failures only lose the customization, not the alert.
  }
}

/** Validates anything read back from storage; null when the shape is unusable. */
export function sanitizeContacts(value: unknown): AlertContact[] | null {
  if (!Array.isArray(value)) return null;
  const contacts: AlertContact[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, phone } = entry as Record<string, unknown>;
    if (typeof phone !== "string") continue;
    const normalized = normalizePhone(phone);
    if (!normalized) continue;
    contacts.push({
      id: typeof id === "string" && id ? id : `contact-${contacts.length + 1}`,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Contact",
      phone: normalized,
    });
  }
  return contacts;
}
