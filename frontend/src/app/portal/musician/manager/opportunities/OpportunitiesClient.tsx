"use client";
/**
 * Opportunity finder — Client Component.
 *
 * Reads the musician's profile server-side (via the Route Handler), queries the
 * events/venue source, ranks by fit, and renders actionable cards.
 *
 * Boundary that matters: the "Draft message" action produces text the ARTIST
 * copies and sends themselves. There is no send button, and no endpoint behind
 * one — see services/opportunities.py for why that is deliberate.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Check,
  Compass,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  PenLine,
  Search,
  Users,
} from "lucide-react";

// ─── Types (mirror backend/models/opportunity.py) ─────────────────────────────

interface Opportunity {
  source: string;
  source_id: string;
  name: string;
  kind: "venue" | "promoter" | "festival" | "agency";
  city: string;
  country: string;
  capacity: number | null;
  genres: string[];
  evidence: string[];
  upcoming_events: number;
  url: string;
  contact_hint: string;
}

interface RankedOpportunity extends Opportunity {
  fit_score: number;
  fit_reason: string;
  suggested_channel: string;
}

interface Draft {
  subject: string;
  body: string;
  channel: string;
}

interface SavedRow {
  source: string;
  source_id: string;
}

type Status = "idle" | "loading" | "success" | "error";

const KIND_LABEL: Record<Opportunity["kind"], string> = {
  venue: "Venue",
  promoter: "Promoter",
  festival: "Festival",
  agency: "Agency",
};

export default function OpportunitiesClient({
  defaultCity,
  savedKeys,
}: {
  defaultCity: string;
  savedKeys: SavedRow[];
}) {
  const [city, setCity] = useState(defaultCity);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RankedOpportunity[]>([]);
  const [live, setLive] = useState<boolean | null>(null);

  // Set of "source:source_id" the user has bookmarked.
  const [saved, setSaved] = useState<Set<string>>(
    () => new Set(savedKeys.map((s) => `${s.source}:${s.source_id}`))
  );

  const search = useCallback(async (targetCity: string) => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/ai/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: targetCity || undefined, size: 8 }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(
          (data?.error as string) ??
            "Could not load opportunities. The AI service may be offline."
        );
        setStatus("error");
        return;
      }
      const data = await response.json();
      setResults((data.opportunities ?? []) as RankedOpportunity[]);
      setLive(Boolean(data.live));
      setStatus("success");
    } catch {
      setError("Could not reach the server.");
      setStatus("error");
    }
  }, []);

  // Search once on mount so the page is useful immediately rather than showing
  // an empty form the user has to submit.
  useEffect(() => {
    void search(defaultCity);
  }, [search, defaultCity]);

  async function toggleSave(opportunity: RankedOpportunity, draft?: Draft) {
    const key = `${opportunity.source}:${opportunity.source_id}`;
    const isSaved = saved.has(key);

    // Optimistic: bookmarking should feel instant. Reverted on failure.
    setSaved((prev) => {
      const next = new Set(prev);
      if (isSaved) next.delete(key);
      else next.add(key);
      return next;
    });

    try {
      if (isSaved) {
        const params = new URLSearchParams({
          source: opportunity.source,
          source_id: opportunity.source_id,
        });
        await fetch(`/api/opportunities/saved?${params}`, { method: "DELETE" });
      } else {
        await fetch("/api/opportunities/saved", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: opportunity.source,
            source_id: opportunity.source_id,
            name: opportunity.name,
            payload: opportunity,
            fit_score: opportunity.fit_score,
            fit_reason: opportunity.fit_reason,
            draft_message: draft ? `${draft.subject}\n\n${draft.body}` : "",
          }),
        });
      }
    } catch {
      setSaved((prev) => {
        const next = new Set(prev);
        if (isSaved) next.add(key);
        else next.delete(key);
        return next;
      });
    }
  }

  return (
    <>
      {/* ── Search ── */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(city);
        }}
        className="flex flex-wrap items-end gap-3 mb-6"
      >
        <div className="flex flex-col gap-1.5 flex-1 min-w-[14rem]">
          <label htmlFor="opp-city" className="u-label text-muted-foreground">
            City
          </label>
          <input
            id="opp-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Barcelona"
            className="w-full rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all duration-200 ease-smooth focus:outline-none focus:ring-2 focus:ring-chimera-clay/35 focus:border-chimera-clay/50"
          />
        </div>
        <button
          type="submit"
          disabled={status === "loading"}
          className="inline-flex items-center gap-2 rounded-pill px-5 py-2.5 text-sm font-medium bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-60"
        >
          {status === "loading" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          {status === "loading" ? "Searching…" : "Find"}
        </button>
      </form>

      {/* Honest provenance banner. A mocked result must never look live. */}
      {live === false && status === "success" && (
        <div className="mb-6 rounded-widget border border-chimera-gold/30 bg-chimera-gold/10 px-5 py-4 animate-scale-in">
          <div className="u-label text-chimera-gold mb-1.5">Demo data</div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            These are real venues from a built-in dataset, not a live search. Set{" "}
            <code className="font-mono text-[0.6875rem] bg-secondary px-1.5 py-0.5 rounded">
              TICKETMASTER_API_KEY
            </code>{" "}
            in <span className="font-mono text-[0.6875rem]">backend/.env</span> to query the
            Ticketmaster Discovery API for live listings.
          </p>
        </div>
      )}

      {status === "error" && (
        <div
          role="alert"
          className="rounded-widget border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive animate-scale-in"
        >
          {error}{" "}
          <button
            type="button"
            onClick={() => void search(city)}
            className="underline underline-offset-4 font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {status === "loading" && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="widget p-5 animate-pulse"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <div className="h-4 w-1/3 bg-secondary rounded mb-3" />
              <div className="h-3 w-2/3 bg-secondary/70 rounded mb-2" />
              <div className="h-3 w-1/2 bg-secondary/50 rounded" />
            </div>
          ))}
        </div>
      )}

      {status === "success" && results.length === 0 && (
        <div className="widget p-10 flex flex-col items-center text-center animate-scale-in">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mb-5">
            <Compass className="w-5 h-5 text-muted-foreground" />
          </div>
          <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Nothing found for {city || "your city"}
          </h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
            Try a nearby larger city, or fill in your genre on your profile so the search has
            more to match against.
          </p>
        </div>
      )}

      {status === "success" && results.length > 0 && (
        <ul className="flex flex-col gap-3">
          {results.map((opportunity, i) => (
            <li key={`${opportunity.source}:${opportunity.source_id}`}>
              <OpportunityCard
                opportunity={opportunity}
                index={i}
                saved={saved.has(`${opportunity.source}:${opportunity.source_id}`)}
                onToggleSave={toggleSave}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function OpportunityCard({
  opportunity,
  index,
  saved,
  onToggleSave,
}: {
  opportunity: RankedOpportunity;
  index: number;
  saved: boolean;
  onToggleSave: (o: RankedOpportunity, draft?: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generateDraft() {
    setDrafting(true);
    setDraftError(null);
    try {
      const response = await fetch("/api/ai/opportunities/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunity: {
            source: opportunity.source,
            source_id: opportunity.source_id,
            name: opportunity.name,
            kind: opportunity.kind,
            city: opportunity.city,
            country: opportunity.country,
            capacity: opportunity.capacity,
            genres: opportunity.genres,
            evidence: opportunity.evidence,
            upcoming_events: opportunity.upcoming_events,
            url: opportunity.url,
            contact_hint: opportunity.contact_hint,
          },
          notes: "",
        }),
      });
      if (!response.ok) {
        setDraftError("Could not draft a message. Try again in a moment.");
        return;
      }
      const data = await response.json();
      setDraft(data.draft as Draft);
    } catch {
      setDraftError("Could not reach the server.");
    } finally {
      setDrafting(false);
    }
  }

  async function copyDraft() {
    if (!draft) return;
    await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Score colouring: only a genuinely strong match earns the clay accent, so
  // the colour carries information rather than decorating every card.
  const scoreTone =
    opportunity.fit_score >= 70
      ? "bg-chimera-clay text-chimera-cream"
      : opportunity.fit_score >= 40
        ? "bg-chimera-gold/20 text-chimera-gold"
        : "bg-secondary text-muted-foreground";

  return (
    <div
      className="widget p-5 animate-fade-up transition-all duration-300 ease-smooth hover:shadow-widget-lg"
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
    >
      <div className="flex items-start gap-4">
        {/* Fit score */}
        <div
          className={`shrink-0 w-12 h-12 rounded-2xl flex flex-col items-center justify-center ${scoreTone}`}
          aria-label={`Fit score ${opportunity.fit_score} out of 100`}
        >
          <span className="text-base font-semibold tabular-nums leading-none">
            {opportunity.fit_score}
          </span>
          <span className="text-[0.5rem] uppercase tracking-wider opacity-70 mt-0.5">fit</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground tracking-tight">{opportunity.name}</h3>
            <span className="u-label rounded-pill bg-secondary text-muted-foreground px-2 py-0.5">
              {KIND_LABEL[opportunity.kind]}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2.5">
            {opportunity.city && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {opportunity.city}
                {opportunity.country ? `, ${opportunity.country}` : ""}
              </span>
            )}
            {opportunity.capacity && (
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                {opportunity.capacity.toLocaleString()} cap
              </span>
            )}
          </div>

          {/* Why it fits — the reason the card exists */}
          {opportunity.fit_reason && (
            <p className="text-sm text-foreground/90 leading-relaxed mb-2.5">
              {opportunity.fit_reason}
            </p>
          )}

          {opportunity.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {opportunity.genres.slice(0, 5).map((genre) => (
                <span
                  key={genre}
                  className="text-[0.6875rem] bg-chimera-clay-muted text-chimera-clay px-2 py-0.5 rounded-pill font-medium"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          {opportunity.evidence.length > 0 && (
            <ul className="flex flex-col gap-1 mb-3">
              {opportunity.evidence.map((line, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-muted-foreground/50 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          )}

          {/* How to contact */}
          {opportunity.suggested_channel && (
            <div className="text-xs text-muted-foreground mb-3">
              <span className="u-label text-muted-foreground/70">How to reach them · </span>
              {opportunity.suggested_channel}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generateDraft}
              disabled={drafting}
              className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-60"
            >
              {drafting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PenLine className="w-3.5 h-3.5" />
              )}
              {draft ? "Redraft message" : "Draft message"}
            </button>

            <button
              type="button"
              onClick={() => onToggleSave(opportunity, draft ?? undefined)}
              aria-pressed={saved}
              className={[
                "inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-xs font-medium border transition-colors",
                saved
                  ? "border-chimera-clay/40 bg-chimera-clay-muted text-chimera-clay"
                  : "border-border hover:bg-secondary",
              ].join(" ")}
            >
              {saved ? (
                <BookmarkCheck className="w-3.5 h-3.5" />
              ) : (
                <Bookmark className="w-3.5 h-3.5" />
              )}
              {saved ? "Saved" : "Save"}
            </button>

            {opportunity.url && (
              <a
                href={opportunity.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Visit
              </a>
            )}
          </div>

          {draftError && (
            <p role="alert" className="text-xs text-destructive mt-2.5">
              {draftError}
            </p>
          )}

          {/* Draft — explicitly framed as something the user sends */}
          {draft && (
            <div className="mt-4 rounded-2xl bg-secondary/50 border border-border p-4 animate-scale-in">
              <div className="flex items-center justify-between gap-3 mb-2.5">
                <span className="u-label text-muted-foreground">Your draft — you send it</span>
                <button
                  type="button"
                  onClick={copyDraft}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-card px-3 py-1.5 text-xs hover:bg-secondary transition-colors"
                >
                  {copied ? (
                    <Check className="w-3 h-3 text-chimera-clay" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="text-xs font-medium text-foreground mb-1.5">{draft.subject}</div>
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {draft.body}
              </p>
              {draft.channel && (
                <div className="u-label text-muted-foreground/70 mt-3 normal-case tracking-normal">
                  Send via: {draft.channel}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
