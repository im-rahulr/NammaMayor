import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  buildAlertMessage,
  formatPhoneForDisplay,
  normalizePhone,
  openWhatsAppTab,
  whatsappBroadcastUrl,
  whatsappUrl,
  type AlertContact,
  type AlertDispatch,
  type IncidentAlertInput,
} from "@/lib/emergency-alerts";

type Props = {
  /** The incident the public alert list was messaged about; null until the first fires. */
  active: { incidentId: string; incident: IncidentAlertInput; dispatch: AlertDispatch } | null;
  contacts: AlertContact[];
  onContactsChange: (next: AlertContact[]) => void;
  autoAlert: boolean;
  onAutoAlertChange: (next: boolean) => void;
};

export function EmergencyAlertPanel({
  active,
  contacts,
  onContactsChange,
  autoAlert,
  onAutoAlertChange,
}: Props) {
  const [nameDraft, setNameDraft] = useState("");
  const [phoneDraft, setPhoneDraft] = useState("");
  // Numbers the operator tapped Send for on this incident.
  const [manualSent, setManualSent] = useState<string[]>([]);

  const message = active ? buildAlertMessage(active.incident) : "";
  const dispatch = active?.dispatch;
  const stage = dispatch?.stage ?? "idle";
  const incidentId = active?.incidentId ?? null;
  // The number the countdown is about to message — not manual, not yet sent.
  const autoPendingId = stage === "preparing" ? (dispatch?.opened?.id ?? null) : null;
  const autoSentId = stage === "sent" ? (dispatch?.opened?.id ?? null) : null;

  useEffect(() => {
    setManualSent([]);
  }, [incidentId]);

  const sentIds = new Set([...(autoSentId ? [autoSentId] : []), ...manualSent]);

  const openTab = (url: string): boolean => {
    if (openWhatsAppTab(url)) return true;
    toast.error("WhatsApp tab blocked", {
      description: "Allow popups for this site, then tap Send again.",
    });
    return false;
  };

  const sendTo = (contact: AlertContact) => {
    if (!message || !openTab(whatsappUrl(contact.phone, message))) return;
    setManualSent((ids) => (ids.includes(contact.id) ? ids : [...ids, contact.id]));
  };

  const sendBroadcast = () => {
    if (!message || !openTab(whatsappBroadcastUrl(message))) return;
    setManualSent(contacts.map((c) => c.id));
  };

  const copyMessage = () => {
    navigator.clipboard
      .writeText(message)
      .then(() => toast.success("Alert text copied"))
      .catch(() => toast.error("Clipboard unavailable"));
  };

  const addContact = () => {
    const phone = normalizePhone(phoneDraft);
    if (!phone) {
      toast.error("Invalid number", { description: "Enter a 10-digit mobile number." });
      return;
    }
    if (contacts.some((c) => c.phone === phone)) {
      toast.error("That number is already on the list");
      return;
    }
    onContactsChange([
      ...contacts,
      { id: `contact-${Date.now()}`, name: nameDraft.trim() || "Contact", phone },
    ]);
    setNameDraft("");
    setPhoneDraft("");
  };

  const unsent = active ? contacts.filter((c) => !sentIds.has(c.id)) : [];

  return (
    <div className="space-y-3 rounded-sm border border-destructive/60 bg-destructive/10 p-3 font-mono text-xs shadow-md">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-bold text-destructive">
          <span className="h-2 w-2 rounded-full bg-destructive animate-ping" />
          📱 WHATSAPP PUBLIC ALERT
        </span>
        <label
          className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground"
          title="Open WhatsApp for these numbers as soon as an incident is marked"
        >
          <input
            type="checkbox"
            checked={autoAlert}
            onChange={(e) => onAutoAlertChange(e.target.checked)}
            className="accent-destructive"
          />
          Auto
        </label>
      </div>

      {active ? (
        <div className="space-y-2">
          <div className="rounded-sm bg-background/70 p-2 text-[10px] leading-relaxed">
            <div className="font-bold text-destructive">
              {active.incident.icon} {active.incident.title}
            </div>
            <div className="text-muted-foreground">
              {active.incident.severity} · {active.incident.locationName} ·{" "}
              {active.incident.timestamp}
            </div>
          </div>

          {stage === "preparing" && (
            <div className="rounded-sm border border-accent/60 bg-accent/10 p-2 text-[10px] leading-relaxed text-accent">
              🤖 COMMS agent broadcasting in {dispatch?.secondsLeft}s — WhatsApp opens
              automatically. Use Send below for the rest.
            </div>
          )}
          {stage === "blocked" && (
            <div className="rounded-sm border border-amber-500/60 bg-amber-500/10 p-2 text-[10px] text-amber-400">
              Browser blocked the WhatsApp window. Tap Send below to warn the numbers.
            </div>
          )}
          {stage === "cancelled" && (
            <div className="rounded-sm border border-border/60 bg-background/60 p-2 text-[10px] text-muted-foreground">
              Broadcast cancelled before it went out.
            </div>
          )}
          {stage === "sent" && (
            <div className="rounded-sm border border-success/50 bg-success/10 p-2 text-[10px] text-success">
              🤖 Advisory broadcast to {dispatch?.opened?.name}.{" "}
              {dispatch && dispatch.queued.length > 0
                ? `${dispatch.queued.length} number(s) still need one tap.`
                : "Everyone on the list is warned."}
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            {unsent.length > 1 && (
              <button
                onClick={sendBroadcast}
                className="flex-1 rounded-sm bg-destructive px-2 py-1.5 text-[10px] font-bold tracking-wider text-destructive-foreground hover:opacity-90"
                title="Opens WhatsApp's own multi-chat picker with this alert pre-filled"
              >
                📣 BROADCAST ALL
              </button>
            )}
            <button
              onClick={copyMessage}
              className="rounded-sm border border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground hover:border-accent hover:text-accent"
            >
              COPY TEXT
            </button>
          </div>

          <details className="text-[10px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Message preview
            </summary>
            <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-sm bg-background/80 p-2 text-[9px] text-muted-foreground">
              {message}
            </pre>
          </details>
        </div>
      ) : (
        <div className="text-[10px] leading-relaxed text-muted-foreground">
          Mark an incident on the map and every number below gets an avoid-travel advisory on
          WhatsApp.
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">
          People to notify ·{" "}
          {active ? `${sentIds.size}/${contacts.length} sent` : `${contacts.length} listed`}
        </div>
        <div className="space-y-1">
          {contacts.map((c) => {
            const sent = sentIds.has(c.id);
            const pendingAuto = c.id === autoPendingId;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-sm border border-border/60 bg-background/60 px-2 py-1"
              >
                <span className="min-w-0 truncate">
                  <span className={sent ? "text-success" : "text-foreground"}>
                    {sent ? "✓" : pendingAuto ? "🤖" : "•"} {c.name}
                  </span>
                  <span className="ml-1 text-muted-foreground">
                    {formatPhoneForDisplay(c.phone)}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {pendingAuto && (
                    <span className="text-[9px] text-accent">{dispatch?.secondsLeft}s</span>
                  )}
                  {active && !sent && !pendingAuto && (
                    <button
                      onClick={() => sendTo(c)}
                      className="rounded-sm border border-destructive/60 px-1.5 py-0.5 text-[9px] text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    >
                      SEND
                    </button>
                  )}
                  <button
                    onClick={() => onContactsChange(contacts.filter((x) => x.id !== c.id))}
                    className="px-1 text-[9px] text-muted-foreground hover:text-destructive"
                    title={`Remove ${c.name}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
          {contacts.length === 0 && (
            <div className="text-[10px] text-muted-foreground">No recipients — add one below.</div>
          )}
        </div>
      </div>

      <div className="space-y-1 border-t border-border/40 pt-2">
        <div className="text-[9px] font-bold tracking-wider text-muted-foreground uppercase">
          Add recipient
        </div>
        <div className="flex gap-1">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Name"
            className="w-1/2 rounded-sm border bg-background px-1.5 py-1 text-[10px] placeholder:text-muted-foreground/60 focus:border-destructive focus:outline-none"
          />
          <input
            value={phoneDraft}
            onChange={(e) => setPhoneDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addContact()}
            placeholder="10-digit mobile"
            inputMode="tel"
            className="w-1/2 rounded-sm border bg-background px-1.5 py-1 text-[10px] placeholder:text-muted-foreground/60 focus:border-destructive focus:outline-none"
          />
        </div>
        <button
          onClick={addContact}
          className="w-full rounded-sm border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:border-destructive hover:text-foreground"
        >
          + ADD NUMBER
        </button>
      </div>
    </div>
  );
}
