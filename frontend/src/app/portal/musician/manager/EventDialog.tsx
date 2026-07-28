"use client";
/**
 * Create / edit / delete dialog for a calendar event.
 *
 * Accessibility & keyboard (this is the piece users hit most, so it earns the
 * detail):
 * - role="dialog" aria-modal, labelled by its heading.
 * - Escape closes. Focus moves to the title field on open and returns to the
 *   trigger on close, so keyboard users don't get dumped at the top of the page.
 * - Tab is trapped inside the panel — without this, tabbing walks into the
 *   calendar behind the overlay, which is invisible but still focusable.
 * - Cmd/Ctrl+Enter submits from anywhere in the form.
 */
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Trash2, X } from "lucide-react";

import { EVENT_TYPES, EVENT_TYPE_META, REMINDER_OPTIONS } from "@/lib/events-schema";
import { toLocalInput, toDateInput, fromLocalInput } from "@/lib/calendar";
import type { EventRow } from "@/types/supabase";

// Form-level schema. Times are local wall-clock strings here and converted to
// UTC instants on submit — see lib/calendar.ts for why that split exists.
const DialogSchema = z
  .object({
    title: z.string().trim().min(1, "Give the event a title.").max(200),
    event_type: z.enum(EVENT_TYPES),
    all_day: z.boolean(),
    starts_at: z.string().min(1, "Pick a start."),
    ends_at: z.string(),
    location: z.string().trim().max(300),
    notes: z.string().trim().max(2000),
    // "" = no reminder. Kept as a string because a <select> value always is.
    reminder: z.string(),
  })
  .refine(
    (v) => !v.ends_at || Date.parse(v.ends_at) >= Date.parse(v.starts_at),
    { path: ["ends_at"], message: "End must be after the start." }
  );

type DialogValues = z.infer<typeof DialogSchema>;

export interface EventDialogProps {
  /** Existing event to edit, or null when creating. */
  event: EventRow | null;
  /** Pre-selected start (UTC ISO) when creating from a day cell. */
  initialStart: string;
  onClose: () => void;
  onSaved: (event: EventRow) => void;
  onDeleted: (id: string) => void;
}

export default function EventDialog({
  event,
  initialStart,
  onClose,
  onSaved,
  onDeleted,
}: EventDialogProps) {
  const isEdit = event !== null;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  // Remember what was focused before opening so we can restore it on close.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const [serverError, setServerError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DialogValues>({
    resolver: zodResolver(DialogSchema),
    defaultValues: {
      title: event?.title ?? "",
      event_type: event?.event_type ?? "gig",
      all_day: event?.all_day ?? false,
      starts_at: event
        ? event.all_day
          ? toDateInput(event.starts_at)
          : toLocalInput(event.starts_at)
        : toLocalInput(initialStart),
      ends_at: event?.ends_at
        ? event.all_day
          ? toDateInput(event.ends_at)
          : toLocalInput(event.ends_at)
        : "",
      location: event?.location ?? "",
      notes: event?.notes ?? "",
      reminder:
        event?.reminder_minutes === null || event?.reminder_minutes === undefined
          ? ""
          : String(event.reminder_minutes),
    },
  });

  const allDay = watch("all_day");
  const selectedType = watch("event_type");

  // ── Focus management ──
  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    // rAF so the field exists and the open animation has started.
    const id = requestAnimationFrame(() => titleRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      returnFocusRef.current?.focus?.();
    };
  }, []);

  // ── Escape to close, Tab trapped inside the panel ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // ── Swapping all-day on/off must not lose the chosen day ──
  useEffect(() => {
    const current = watch("starts_at");
    if (!current) return;
    if (allDay && current.includes("T")) {
      setValue("starts_at", current.slice(0, 10));
      const end = watch("ends_at");
      if (end) setValue("ends_at", end.slice(0, 10));
    } else if (!allDay && !current.includes("T")) {
      setValue("starts_at", `${current}T20:00`);
      const end = watch("ends_at");
      if (end && !end.includes("T")) setValue("ends_at", `${end}T21:00`);
    }
    // watch/setValue are stable; re-running on `allDay` alone is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDay]);

  async function onSubmit(values: DialogValues) {
    setServerError(null);

    const body = {
      title: values.title,
      event_type: values.event_type,
      all_day: values.all_day,
      starts_at: fromLocalInput(values.starts_at),
      ends_at: values.ends_at ? fromLocalInput(values.ends_at) : null,
      location: values.location,
      notes: values.notes,
      // "" means "no reminder" → null, which the CHECK constraint allows and 0
      // does not conflate with ("at start time" is a real, different choice).
      reminder_minutes: values.reminder === "" ? null : Number(values.reminder),
    };

    const url = isEdit ? `/api/events/${event.id}` : "/api/events";
    const method = isEdit ? "PATCH" : "POST";

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setServerError("Could not reach the server. Check your connection.");
      return;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setServerError((data?.error as string) ?? "Could not save this event.");
      return;
    }

    onSaved((await response.json()) as EventRow);
  }

  async function handleDelete() {
    if (!event) return;
    setDeleting(true);
    setServerError(null);
    try {
      const response = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
      if (!response.ok) {
        setServerError("Could not delete this event.");
        setDeleting(false);
        return;
      }
      onDeleted(event.id);
    } catch {
      setServerError("Could not reach the server.");
      setDeleting(false);
    }
  }

  const inputClass = [
    "w-full rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-foreground",
    "placeholder:text-muted-foreground/50 transition-all duration-200 ease-smooth",
    "focus:outline-none focus:ring-2 focus:ring-chimera-clay/35 focus:border-chimera-clay/50",
  ].join(" ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="presentation"
    >
      {/* Overlay — click to dismiss. aria-hidden so SRs only see the panel. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-chimera-ink/40 backdrop-blur-sm animate-fade-in cursor-default"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        className="relative w-full sm:max-w-lg widget p-6 sm:p-7 max-h-[92vh] overflow-y-auto animate-scale-in rounded-b-none sm:rounded-widget"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="u-label text-muted-foreground mb-1.5">
              {isEdit ? "Edit" : "New"}
            </div>
            <h2
              id="event-dialog-title"
              className="font-display text-2xl font-semibold tracking-tight text-foreground"
            >
              {isEdit ? "Event details" : "Add to calendar"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter submits from any field, including the textarea.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit(onSubmit)();
            }
          }}
          noValidate
          className="flex flex-col gap-4"
        >
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-title" className="u-label text-muted-foreground">
              Title
            </label>
            <input
              id="event-title"
              placeholder="Sala Apolo — headline set"
              aria-invalid={errors.title ? true : undefined}
              className={inputClass}
              {...register("title")}
              ref={(el) => {
                register("title").ref(el);
                titleRef.current = el;
              }}
            />
            {errors.title && (
              <p role="alert" className="text-xs text-destructive">
                {errors.title.message}
              </p>
            )}
          </div>

          {/* Type — segmented pills */}
          <div className="flex flex-col gap-1.5">
            <span className="u-label text-muted-foreground">Type</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Event type">
              {EVENT_TYPES.map((type) => {
                const meta = EVENT_TYPE_META[type];
                const active = selectedType === type;
                return (
                  <label
                    key={type}
                    className={[
                      "cursor-pointer rounded-pill px-3.5 py-1.5 text-xs font-medium border",
                      "transition-all duration-300 ease-smooth",
                      "focus-within:ring-2 focus-within:ring-chimera-clay/35",
                      active
                        ? `${meta.chip} border-transparent scale-[1.02]`
                        : "border-border text-muted-foreground hover:bg-secondary",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      value={type}
                      className="sr-only"
                      {...register("event_type")}
                    />
                    {meta.label}
                  </label>
                );
              })}
            </div>
          </div>

          {/* All-day toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 rounded accent-chimera-clay"
              {...register("all_day")}
            />
            <span className="text-sm text-foreground">All day</span>
          </label>

          {/* Start / end */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-start" className="u-label text-muted-foreground">
                Starts
              </label>
              <input
                id="event-start"
                type={allDay ? "date" : "datetime-local"}
                aria-invalid={errors.starts_at ? true : undefined}
                className={inputClass}
                {...register("starts_at")}
              />
              {errors.starts_at && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.starts_at.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="event-end" className="u-label text-muted-foreground">
                Ends <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input
                id="event-end"
                type={allDay ? "date" : "datetime-local"}
                aria-invalid={errors.ends_at ? true : undefined}
                className={inputClass}
                {...register("ends_at")}
              />
              {errors.ends_at && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.ends_at.message}
                </p>
              )}
            </div>
          </div>

          {/* Location */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-location" className="u-label text-muted-foreground">
              Location
            </label>
            <input
              id="event-location"
              placeholder="Carrer Nou de la Rambla 113, Barcelona"
              className={inputClass}
              {...register("location")}
            />
          </div>

          {/* Reminder */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-reminder" className="u-label text-muted-foreground">
              Reminder
            </label>
            <select id="event-reminder" className={inputClass} {...register("reminder")}>
              {REMINDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-[0.625rem] text-muted-foreground/70 leading-relaxed">
              Delivered by your own calendar app — reminders are written into the
              .ics export and pushed to connected calendars.
            </p>
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="event-notes" className="u-label text-muted-foreground">
              Notes
            </label>
            <textarea
              id="event-notes"
              rows={3}
              placeholder="Load-in 18:00, 40 min set, bring the SM58."
              className={`${inputClass} resize-none`}
              {...register("notes")}
            />
          </div>

          {serverError && (
            <div
              role="alert"
              className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive animate-scale-in"
            >
              {serverError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {isEdit &&
              (confirmingDelete ? (
                // Two-step delete: destructive and irreversible, so it should
                // never happen on a single mis-click.
                <div className="flex items-center gap-1.5 animate-fade-in">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2.5 text-xs font-medium bg-destructive text-destructive-foreground transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                  >
                    {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-pill px-3 py-2.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label="Delete event"
                  className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2.5 text-xs font-medium text-destructive border border-destructive/25 hover:bg-destructive/5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              ))}

            <div className="flex-1" />

            <button
              type="button"
              onClick={onClose}
              className="rounded-pill px-4 py-2.5 text-sm text-muted-foreground hover:bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || deleting}
              className="inline-flex items-center gap-2 rounded-pill px-5 py-2.5 text-sm font-medium bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEdit ? "Save" : "Add event"}
            </button>
          </div>

          <p className="u-label text-muted-foreground/50 text-center normal-case tracking-normal">
            ⌘/Ctrl + Enter to save · Esc to close
          </p>
        </form>
      </div>
    </div>
  );
}
