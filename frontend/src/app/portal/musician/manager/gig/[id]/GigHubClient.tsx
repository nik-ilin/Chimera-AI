"use client";
/**
 * Gig hub — one show with every related entity attached.
 *
 * This is the core claim of the module made literal: venue, promoter, bookings,
 * money and performance notes are not separate screens, they are sections of
 * the thing they belong to, each addable inline without navigating away.
 *
 * Editing is optimistic throughout — a PATCH that fails rolls the field back
 * and says so, rather than blocking the UI behind a spinner for every keystroke.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BedDouble,
  Building2,
  Check,
  CircleDollarSign,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { GIG_STATUSES, GIG_STATUS_META } from "@/lib/events-schema";
import { formatMoney } from "@/lib/money";
import type {
  BookingRow,
  ContactRow,
  EventRow,
  ExpenseRow,
  GigStatus,
  VenueRow,
} from "@/types/supabase";

interface Props {
  event: EventRow;
  venue: VenueRow | null;
  promoter: ContactRow | null;
  bookings: BookingRow[];
  expenses: ExpenseRow[];
  finance: { feeCents: number; costCents: number; netCents: number; currency: string };
}

type Panel = null | "venue" | "promoter" | "booking";

export default function GigHubClient(props: Props) {
  const router = useRouter();
  const [event, setEvent] = useState(props.event);
  const [bookings, setBookings] = useState(props.bookings);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** PATCH one or more event fields, rolling back on failure. */
  async function patchEvent(patch: Partial<EventRow>) {
    const previous = event;
    setEvent({ ...event, ...patch });
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        setEvent(previous);
        const data = await response.json().catch(() => ({}));
        setError((data?.error as string) ?? "Could not save that change.");
        return;
      }
      setEvent((await response.json()) as EventRow);
      router.refresh();
    } catch {
      setEvent(previous);
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const isGig = event.event_type === "gig";

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      {error && (
        <div
          role="alert"
          className="lg:col-span-3 rounded-widget border border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive animate-scale-in flex items-center gap-3"
        >
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Left: the gig itself ── */}
      <div className="lg:col-span-2 flex flex-col gap-5">
        {/* Status + money */}
        {isGig && (
          <section className="widget p-5 animate-fade-up">
            <div className="u-label text-muted-foreground mb-3">Status</div>
            <div className="flex flex-wrap gap-1.5 mb-5" role="radiogroup" aria-label="Gig status">
              {GIG_STATUSES.map((status) => {
                const meta = GIG_STATUS_META[status];
                const active = event.gig_status === status;
                return (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => patchEvent({ gig_status: status as GigStatus })}
                    className={[
                      "rounded-pill px-3.5 py-1.5 text-xs font-medium border transition-all duration-300 ease-smooth",
                      active
                        ? `${meta.chip} border-transparent scale-[1.03]`
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    {meta.label}
                  </button>
                );
              })}
              {saving && <Loader2 className="w-4 h-4 animate-spin text-chimera-clay self-center ml-1" />}
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <MoneyTile
                label="Fee"
                cents={props.finance.feeCents}
                currency={props.finance.currency}
                editable
                onSave={(cents) => patchEvent({ fee_cents: cents })}
              />
              <MoneyTile
                label="Costs"
                cents={-props.finance.costCents}
                currency={props.finance.currency}
              />
              <MoneyTile
                label="Net"
                cents={props.finance.netCents}
                currency={props.finance.currency}
                emphasise
              />
            </div>
          </section>
        )}

        {/* Venue */}
        <Section
          title="Venue"
          icon={Building2}
          onAdd={props.venue ? undefined : () => setPanel(panel === "venue" ? null : "venue")}
          addLabel="Add venue"
        >
          {props.venue ? (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground">{props.venue.name}</div>
                {props.venue.address && (
                  <div className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
                    <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{props.venue.address}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                  {props.venue.capacity && (
                    <span>{props.venue.capacity.toLocaleString()} capacity</span>
                  )}
                  {props.venue.city && (
                    <span>
                      {props.venue.city}
                      {props.venue.country ? `, ${props.venue.country}` : ""}
                    </span>
                  )}
                </div>
              </div>
              {props.venue.website && (
                <a
                  href={props.venue.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-pill border border-border px-3 py-1.5 text-xs hover:bg-secondary transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Site
                </a>
              )}
            </div>
          ) : panel === "venue" ? (
            <InlineForm
              fields={[
                { name: "name", label: "Venue name", required: true },
                { name: "city", label: "City" },
                { name: "address", label: "Address" },
                { name: "capacity", label: "Capacity", type: "number" },
              ]}
              submitLabel="Add venue"
              onCancel={() => setPanel(null)}
              onSubmit={async (values) => {
                await fetch("/api/venues", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: values.name,
                    city: values.city ?? "",
                    address: values.address ?? "",
                    capacity: values.capacity ? Number(values.capacity) : null,
                    attach_to_event_id: event.id,
                  }),
                });
                setPanel(null);
                router.refresh();
              }}
            />
          ) : (
            <EmptyRow text="No venue attached yet." />
          )}
        </Section>

        {/* Promoter */}
        <Section
          title="Promoter"
          icon={UserRound}
          onAdd={
            props.promoter ? undefined : () => setPanel(panel === "promoter" ? null : "promoter")
          }
          addLabel="Add promoter"
        >
          {props.promoter ? (
            <div>
              <div className="font-semibold text-foreground">{props.promoter.name}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                {props.promoter.organisation && <span>{props.promoter.organisation}</span>}
                {props.promoter.email && (
                  <a
                    href={`mailto:${props.promoter.email}`}
                    className="text-chimera-clay hover:underline underline-offset-4"
                  >
                    {props.promoter.email}
                  </a>
                )}
                {props.promoter.phone && <span>{props.promoter.phone}</span>}
              </div>
            </div>
          ) : panel === "promoter" ? (
            <InlineForm
              fields={[
                { name: "name", label: "Name", required: true },
                { name: "organisation", label: "Organisation" },
                { name: "email", label: "Email", type: "email" },
                { name: "phone", label: "Phone" },
              ]}
              submitLabel="Add promoter"
              onCancel={() => setPanel(null)}
              onSubmit={async (values) => {
                await fetch("/api/contacts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: values.name,
                    organisation: values.organisation ?? "",
                    email: values.email ?? "",
                    phone: values.phone ?? "",
                    role: "promoter",
                    attach_to_event_id: event.id,
                  }),
                });
                setPanel(null);
                router.refresh();
              }}
            />
          ) : (
            <EmptyRow text="No promoter attached yet." />
          )}
        </Section>

        {/* Performance notes */}
        {isGig && (
          <Section title="Setlist & rider" icon={Building2}>
            <div className="grid sm:grid-cols-2 gap-4">
              <NotesField
                label="Setlist"
                value={event.setlist}
                placeholder="1. Neon Arcadia&#10;2. Slow Exit…"
                onSave={(v) => patchEvent({ setlist: v })}
              />
              <NotesField
                label="Rider"
                value={event.rider}
                placeholder="2× DI, 4× mic stands, 6 waters…"
                onSave={(v) => patchEvent({ rider: v })}
              />
            </div>
          </Section>
        )}
      </div>

      {/* ── Right: logistics ── */}
      <aside className="flex flex-col gap-5">
        <Section
          title="Accommodation & travel"
          icon={BedDouble}
          onAdd={() => setPanel(panel === "booking" ? null : "booking")}
          addLabel="Add booking"
        >
          {panel === "booking" && (
            <InlineForm
              fields={[
                { name: "name", label: "Name", required: true },
                { name: "kind", label: "Kind", type: "select", options: ["accommodation", "travel", "backline", "other"] },
                { name: "check_in", label: "Check in", type: "datetime-local" },
                { name: "check_out", label: "Check out", type: "datetime-local" },
                { name: "cost", label: "Cost (€)", type: "number" },
                { name: "reference", label: "Reference" },
              ]}
              submitLabel="Add booking"
              onCancel={() => setPanel(null)}
              onSubmit={async (values) => {
                const response = await fetch("/api/bookings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    event_id: event.id,
                    name: values.name,
                    kind: values.kind || "accommodation",
                    status: "confirmed",
                    check_in: values.check_in
                      ? new Date(values.check_in).toISOString()
                      : null,
                    check_out: values.check_out
                      ? new Date(values.check_out).toISOString()
                      : null,
                    // Euros in the form, minor units on the wire.
                    cost_cents: values.cost ? Math.round(Number(values.cost) * 100) : 0,
                    reference: values.reference ?? "",
                  }),
                });
                if (response.ok) {
                  // Resolve the body BEFORE the state updater — the updater is
                  // sync and cannot await.
                  const created = (await response.json()) as BookingRow;
                  setBookings((prev) => [...prev, created]);
                }
                setPanel(null);
                router.refresh();
              }}
            />
          )}

          {bookings.length === 0 && panel !== "booking" ? (
            <EmptyRow text="Nowhere to stay booked yet." />
          ) : (
            <ul className="flex flex-col gap-2">
              {bookings.map((booking) => (
                <li
                  key={booking.id}
                  className="rounded-2xl border border-border bg-background/50 p-3 animate-scale-in"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {booking.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 capitalize">
                        {booking.kind} · {booking.status}
                      </div>
                      {booking.check_in && (
                        <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                          {new Date(booking.check_in).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}
                          {booking.check_out &&
                            ` → ${new Date(booking.check_out).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                            })}`}
                        </div>
                      )}
                      {booking.reference && (
                        <div className="text-[0.6875rem] text-muted-foreground/70 mt-1 font-mono">
                          {booking.reference}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      {booking.cost_cents > 0 && (
                        <div className="text-sm tabular-nums text-foreground">
                          {formatMoney(booking.cost_cents, booking.currency)}
                        </div>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${booking.name}`}
                        onClick={async () => {
                          setBookings((prev) => prev.filter((b) => b.id !== booking.id));
                          await fetch(`/api/bookings/${booking.id}`, { method: "DELETE" });
                          router.refresh();
                        }}
                        className="mt-1.5 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Ledger */}
        <Section title="Ledger" icon={CircleDollarSign}>
          {props.expenses.length === 0 ? (
            <EmptyRow text="Confirmed bookings post here automatically." />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {props.expenses.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 text-xs">
                  <span className="flex-1 min-w-0 truncate text-foreground">
                    {entry.description || entry.kind}
                  </span>
                  <span
                    className={[
                      "tabular-nums shrink-0",
                      entry.amount_cents < 0 ? "text-destructive" : "text-emerald-700",
                    ].join(" ")}
                  >
                    {formatMoney(entry.amount_cents, entry.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </aside>
    </div>
  );
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Section({
  title,
  icon: Icon,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  icon: typeof Building2;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="widget p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-3">
        <div className="u-label text-muted-foreground flex items-center gap-1.5">
          <Icon className="w-3 h-3" />
          {title}
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 rounded-pill border border-border px-2.5 py-1 text-[0.6875rem] font-medium hover:bg-secondary transition-colors"
          >
            <Plus className="w-3 h-3" />
            {addLabel}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Empty states always say what happens next, never just "nothing here". */
function EmptyRow({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground/70 leading-relaxed">{text}</p>;
}

function MoneyTile({
  label,
  cents,
  currency,
  emphasise = false,
  editable = false,
  onSave,
}: {
  label: string;
  cents: number;
  currency: string;
  emphasise?: boolean;
  editable?: boolean;
  onSave?: (cents: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(Math.abs(cents) / 100));

  if (editing && editable) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave?.(Math.round(Number(draft || 0) * 100));
          setEditing(false);
        }}
        className="rounded-2xl bg-secondary/60 px-4 py-3"
      >
        <div className="u-label text-muted-foreground mb-1.5">{label}</div>
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type="number"
            min={0}
            step="1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setEditing(false)}
            className="w-full bg-transparent text-lg font-semibold tabular-nums focus:outline-none"
          />
          <button type="submit" aria-label="Save fee" className="text-chimera-clay">
            <Check className="w-4 h-4" />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div
      className={[
        "rounded-2xl px-4 py-3",
        emphasise
          ? cents >= 0
            ? "bg-chimera-clay-muted"
            : "bg-destructive/10"
          : "bg-secondary/60",
        editable ? "cursor-pointer hover:bg-secondary transition-colors" : "",
      ].join(" ")}
      onClick={editable ? () => setEditing(true) : undefined}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      onKeyDown={
        editable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setEditing(true);
              }
            }
          : undefined
      }
    >
      <div className="u-label text-muted-foreground mb-1.5">{label}</div>
      <div
        className={[
          "text-lg font-semibold tabular-nums",
          emphasise && cents < 0 ? "text-destructive" : "text-foreground",
        ].join(" ")}
      >
        {formatMoney(cents, currency)}
      </div>
      {editable && <div className="u-label text-muted-foreground/50 mt-1">tap to edit</div>}
    </div>
  );
}

function NotesField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const dirty = draft !== value;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="u-label text-muted-foreground">{label}</label>
      <textarea
        rows={5}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        // Save on blur rather than per keystroke: one PATCH per edit session
        // instead of one per character.
        onBlur={() => dirty && onSave(draft)}
        className="w-full rounded-2xl border border-border bg-card px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 resize-none transition-all focus:outline-none focus:ring-2 focus:ring-chimera-clay/35"
      />
      {dirty && <span className="u-label text-chimera-clay">unsaved — click away to save</span>}
    </div>
  );
}

interface Field {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[];
}

function InlineForm({
  fields,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  fields: Field[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const inputClass =
    "w-full rounded-xl border border-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 transition-all focus:outline-none focus:ring-2 focus:ring-chimera-clay/35";

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(values);
        } finally {
          setBusy(false);
        }
      }}
      className="flex flex-col gap-2 rounded-2xl bg-secondary/50 border border-border p-3 mb-3 animate-scale-in"
    >
      {fields.map((field) => (
        <div key={field.name} className="flex flex-col gap-1">
          <label htmlFor={`f-${field.name}`} className="u-label text-muted-foreground">
            {field.label}
          </label>
          {field.type === "select" ? (
            <select
              id={`f-${field.name}`}
              value={values[field.name] ?? field.options?.[0] ?? ""}
              onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              className={`${inputClass} capitalize`}
            >
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`f-${field.name}`}
              type={field.type ?? "text"}
              required={field.required}
              value={values[field.name] ?? ""}
              onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              className={inputClass}
            />
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-xs font-medium bg-chimera-clay text-chimera-cream transition-all hover:brightness-105 disabled:opacity-60"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-pill px-3 py-1.5 text-xs text-muted-foreground hover:bg-card transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
