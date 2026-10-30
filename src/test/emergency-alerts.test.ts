import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_CONTACTS_STORAGE_KEY,
  DEFAULT_ALERT_CONTACTS,
  buildAlertMessage,
  formatPhoneForDisplay,
  loadAlertContacts,
  normalizePhone,
  sanitizeContacts,
  saveAlertContacts,
  schedulePublicAlert,
  whatsappBroadcastUrl,
  whatsappUrl,
  type AlertContact,
  type AlertDispatch,
  type IncidentAlertInput,
  type IncidentType,
} from "@/lib/emergency-alerts";

const incident: IncidentAlertInput = {
  type: "flood",
  icon: "🌊",
  typeName: "Flood / Inundation",
  title: "Flood / Inundation at Silk Board Junction",
  locationName: "Silk Board Junction",
  lat: 12.9177,
  lng: 77.6238,
  radiusM: 400,
  severity: "CRITICAL",
  timestamp: "18:42:05",
  description: "ORR underpass submerged with 0.65m water.",
};

describe("WhatsApp public emergency alerts", () => {
  it("ships the operator's three numbers as defaults, normalised to +91", () => {
    expect(DEFAULT_ALERT_CONTACTS.map((c) => c.phone)).toEqual([
      "918618140050",
      "919739904620",
      "917349321463",
    ]);
  });

  it("normalises the ways an operator types a mobile number", () => {
    expect(normalizePhone("8618140050")).toBe("918618140050");
    expect(normalizePhone("+91 86181-40050")).toBe("918618140050");
    expect(normalizePhone("08618140050")).toBe("918618140050");
    expect(normalizePhone("00918618140050")).toBe("918618140050");
    expect(normalizePhone("+1 415 555 0123")).toBe("14155550123");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });

  it("formats numbers for display without exposing raw digits", () => {
    expect(formatPhoneForDisplay("918618140050")).toBe("+91 86181 40050");
    expect(formatPhoneForDisplay("14155550123")).toBe("+14155550123");
  });

  it("writes a warning a passer-by can act on, not an internal ops report", () => {
    const msg = buildAlertMessage(incident);
    expect(msg).toContain("PUBLIC SAFETY ALERT");
    expect(msg).toContain("AVOID TRAVELLING");
    expect(msg).toContain("Flood / Inundation");
    expect(msg).toContain("Silk Board Junction");
    expect(msg).toContain("Severity CRITICAL");
    expect(msg).toContain("400 m");
    expect(msg).toContain("Do not drive or wade through floodwater");
    expect(msg).toContain("ORR underpass submerged");
    expect(msg).toContain("112 Police");
    expect(msg).toContain("map=17/12.91770/77.62380");
  });

  it("keeps officer dispatch jargon out of the public message", () => {
    const msg = buildAlertMessage(incident);
    expect(msg).not.toMatch(/EMS|rescue patrol|containment envelope|sensor node/i);
  });

  const advisories: [IncidentType, string][] = [
    ["gas", "Shelter in place"],
    ["fire", "use stairs never lifts"],
    ["roadblock", "Follow the signed diversion"],
    ["medical", "Keep the emergency lane free"],
    ["accident", "Keep the carriageway clear"],
    ["flood", "higher ground"],
  ];
  it.each(advisories)("advises the public for a %s incident", (type, expected) => {
    expect(buildAlertMessage({ ...incident, type })).toContain(expected);
  });

  it("builds wa.me links with the message url-encoded", () => {
    const url = whatsappUrl("918618140050", "Avoid travelling 🚨");
    expect(url).toBe("https://wa.me/918618140050?text=Avoid%20travelling%20%F0%9F%9A%A8");
    expect(whatsappBroadcastUrl("hi")).toBe("https://wa.me/?text=hi");
  });

  describe("COMMS agent broadcast", () => {
    const makePopup = () => {
      const doc = document.implementation.createHTMLDocument("pending");
      const popup = { document: doc, location: { href: "" }, close: vi.fn() };
      return { doc, popup: popup as unknown as Window };
    };

    const schedule = (popup: Window | null, contacts = DEFAULT_ALERT_CONTACTS) => {
      const updates: AlertDispatch[] = [];
      const open = vi.spyOn(window, "open").mockReturnValue(popup);
      const cancel = schedulePublicAlert(incident, contacts, (d) => updates.push(d));
      return { updates, open, cancel };
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("waits 5 seconds before anything reaches WhatsApp", () => {
      const { popup, doc } = makePopup();
      const { updates, open } = schedule(popup);

      expect(open).toHaveBeenCalledTimes(1);
      expect(popup.location.href).toBe("");
      expect(updates[0]!.stage).toBe("preparing");
      expect(updates[0]!.secondsLeft).toBe(5);
      expect(doc.body.textContent).toContain("COMMS AGENT");
      expect(doc.body.textContent).toContain("AVOID TRAVELLING");

      vi.advanceTimersByTime(4_000);
      expect(popup.location.href).toBe("");
      expect(doc.body.textContent).toContain("1s");
    });

    it("releases the advisory to the first number and queues the rest", () => {
      const { popup } = makePopup();
      const { updates } = schedule(popup);

      vi.advanceTimersByTime(5_000);

      expect(popup.location.href).toBe(whatsappUrl("918618140050", updates[0]!.message));
      const last = updates.at(-1)!;
      expect(last.stage).toBe("sent");
      expect(last.opened?.phone).toBe("918618140050");
      expect(last.queued.map((c) => c.phone)).toEqual(["919739904620", "917349321463"]);
    });

    it("reports the countdown every second but sends only once", () => {
      const { popup } = makePopup();
      const { updates } = schedule(popup);

      vi.advanceTimersByTime(5_000);

      expect(updates.filter((u) => u.stage === "preparing")).toHaveLength(5);
      expect(updates.filter((u) => u.stage === "sent")).toHaveLength(1);
    });

    it("aborts cleanly when the operator clears the incident", () => {
      const { popup } = makePopup();
      const { updates, cancel } = schedule(popup);

      vi.advanceTimersByTime(2_000);
      cancel();
      vi.advanceTimersByTime(10_000);

      expect(popup.close).toHaveBeenCalledTimes(1);
      expect(popup.location.href).toBe("");
      expect(updates.at(-1)!.stage).toBe("cancelled");
    });

    it("falls back to manual sending when the browser blocks the window", () => {
      const { updates, open } = schedule(null);

      expect(open).toHaveBeenCalledTimes(1);
      expect(updates).toHaveLength(1);
      expect(updates[0]!.stage).toBe("blocked");
      expect(updates[0]!.queued).toHaveLength(3);
    });

    it("sends nothing when no numbers are listed", () => {
      const { popup } = makePopup();
      const { updates, open } = schedule(popup, []);

      expect(open).not.toHaveBeenCalled();
      expect(updates[0]!.stage).toBe("blocked");
      expect(updates[0]!.queued).toEqual([]);
    });
  });

  describe("alert number list persistence", () => {
    // This jsdom build does not expose Storage, so stub the bits the lib uses.
    beforeEach(() => {
      const store = new Map<string, string>();
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        writable: true,
        value: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
          clear: () => store.clear(),
        },
      });
    });

    it("falls back to the default numbers when nothing is stored", () => {
      expect(loadAlertContacts()).toEqual(DEFAULT_ALERT_CONTACTS);
    });

    it("round-trips an edited number list", () => {
      const edited: AlertContact[] = [
        { id: "x", name: "Mayor's Office", phone: "919880000111" },
        ...DEFAULT_ALERT_CONTACTS,
      ];
      saveAlertContacts(edited);
      expect(window.localStorage.getItem(ALERT_CONTACTS_STORAGE_KEY)).toBeTruthy();
      expect(loadAlertContacts()).toEqual(edited);
    });

    it("drops malformed or unusable stored entries", () => {
      expect(sanitizeContacts(null)).toBeNull();
      expect(sanitizeContacts([{ name: "No phone" }, { phone: "123" }, "junk"])).toEqual([]);
      expect(sanitizeContacts([{ name: "  Metro  ", phone: "98800 00111" }])).toEqual([
        { id: "contact-1", name: "Metro", phone: "919880000111" },
      ]);
    });
  });
});
