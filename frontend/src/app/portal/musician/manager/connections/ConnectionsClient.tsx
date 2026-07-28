"use client";
/**
 * Connect a service — Client Component.
 *
 * One card per available adapter, merging the server-side catalogue (what
 * exists, what is configured) with the user's live connection state (connected,
 * syncing, error, expired).
 *
 * UX rules this screen follows, per the Block 1 bar:
 *  - No dead ends. An unconfigured provider explains which env var is missing
 *    instead of offering a button that fails.
 *  - Optimistic + honest. "Connect" flips to a syncing state immediately, then
 *    reconciles with the real result.
 *  - Skeletons, never a blank screen.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Loader2,
  Plug,
  RefreshCw,
  Rss,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import type { ConnectionStatus } from "@/types/supabase";

// ─── Types (mirror the FastAPI catalogue payload) ────────────────────────────

interface Connector {
  provider: string;
  label: string;
  description: string;
  icon: string;
  configured: boolean;
  missing_env: string[];
  capabilities: { pull: boolean; push: boolean; oauth: boolean; demo: boolean };
}

interface Connection {
  id: string;
  provider: string;
  status: ConnectionStatus;
  account_label: string;
  last_synced_at: string | null;
  last_error: string;
  consecutive_failures: number;
}

/** Lucide names the backend may send, mapped to real components. */
const ICONS: Record<string, typeof Plug> = {
  CalendarDays,
  Rss,
  Sparkles,
  Plug,
};

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; dot: string; chip: string }
> = {
  connected: {
    label: "Connected",
    dot: "bg-emerald-600",
    chip: "bg-emerald-600/10 text-emerald-700",
  },
  syncing: {
    label: "Syncing",
    dot: "bg-chimera-gold animate-pulse",
    chip: "bg-chimera-gold/15 text-chimera-gold",
  },
  error: {
    label: "Needs attention",
    dot: "bg-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
  expired: {
    label: "Reconnect needed",
    dot: "bg-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
  disconnected: {
    label: "Not connected",
    dot: "bg-muted-foreground/40",
    chip: "bg-secondary text-muted-foreground",
  },
};

interface Props {
  /** ?connected= / ?error= handed back by the OAuth callback redirect. */
  flash: { connected?: string; error?: string };
}

export default function ConnectionsClient({ flash }: Props) {
  const router = useRouter();
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [vaultReady, setVaultReady] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [caldavFor, setCaldavFor] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(
    flash.connected
      ? `${flash.connected.replace(/_/g, " ")} connected.`
      : flash.error
        ? `Connection failed: ${flash.error.replace(/_/g, " ")}`
        : null
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setLoadError((data?.error as string) ?? "Could not load integrations.");
        setConnectors([]);
        return;
      }
      const data = await response.json();
      setConnectors(data.connectors ?? []);
      setConnections(data.connections ?? []);
      setVaultReady(Boolean(data.vaultReady));
      setLoadError(null);
    } catch {
      setLoadError("Could not reach the server.");
      setConnectors([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function connectionFor(provider: string): Connection | undefined {
    return connections.find((c) => c.provider === provider);
  }

  async function connect(connector: Connector, extra?: Record<string, unknown>) {
    // CalDAV needs credentials first — open the inline form rather than firing
    // a request that must fail.
    if (connector.provider === "caldav" && !extra) {
      setCaldavFor(connector.provider);
      return;
    }

    setBusy(connector.provider);
    setBanner(null);
    try {
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: connector.provider,
          config: extra?.config ?? {},
          secret: extra?.secret ?? "",
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setBanner((data?.error as string) ?? "Could not connect.");
        return;
      }

      // OAuth: hand the browser to the provider's consent screen. The callback
      // redirects back here with ?connected= or ?error=.
      if (data.mode === "oauth" && data.authorize_url) {
        window.location.href = data.authorize_url as string;
        return;
      }

      const synced = data.sync as { ok?: boolean; created?: number } | undefined;
      setBanner(
        synced?.ok
          ? `${connector.label} connected — imported ${synced.created ?? 0} events.`
          : `${connector.label} connected.`
      );
      setCaldavFor(null);
      await load();
      // Refresh Server Components so the calendar and timeline pick up the new
      // events without a manual reload.
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function syncNow(connection: Connection) {
    setBusy(connection.provider);
    try {
      const response = await fetch(`/api/connections/${connection.id}/sync`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      setBanner(
        data?.ok
          ? `Synced — ${data.created ?? 0} new, ${data.updated ?? 0} updated.`
          : `Sync failed: ${data?.detail ?? data?.error ?? "unknown error"}`
      );
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(connection: Connection) {
    setBusy(connection.provider);
    try {
      await fetch(`/api/connections/${connection.id}`, { method: "DELETE" });
      setBanner("Disconnected. Imported events were kept.");
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {banner && (
        <div className="mb-5 flex items-start gap-3 rounded-widget border border-border bg-card px-5 py-4 animate-scale-in">
          <Check className="w-4 h-4 text-chimera-clay mt-0.5 shrink-0" />
          <p className="text-sm text-foreground flex-1">{banner}</p>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {!vaultReady && (
        <div className="mb-5 rounded-widget border border-chimera-gold/30 bg-chimera-gold/10 px-5 py-4">
          <div className="u-label text-chimera-gold mb-1.5 flex items-center gap-1.5">
            <TriangleAlert className="w-3 h-3" />
            Token vault not configured
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <code className="font-mono text-[0.6875rem] bg-secondary px-1.5 py-0.5 rounded">
              OAUTH_TOKEN_ENCRYPTION_KEY
            </code>{" "}
            is unset, so OAuth connections are disabled — tokens could not be
            encrypted at rest. Generate one with{" "}
            <code className="font-mono text-[0.6875rem]">openssl rand -hex 32</code> and
            add it to <span className="font-mono text-[0.6875rem]">backend/.env</span>.
            CalDAV and demo data still work.
          </p>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="mb-5 rounded-widget border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive"
        >
          {loadError}{" "}
          <button
            type="button"
            onClick={() => void load()}
            className="underline underline-offset-4 font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Skeletons — never a blank screen. */}
      {connectors === null && (
        <div className="grid sm:grid-cols-2 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="widget p-5 animate-pulse"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <div className="h-9 w-9 rounded-xl bg-secondary mb-4" />
              <div className="h-4 w-1/2 bg-secondary rounded mb-2" />
              <div className="h-3 w-3/4 bg-secondary/60 rounded" />
            </div>
          ))}
        </div>
      )}

      {connectors !== null && (
        <div className="grid sm:grid-cols-2 gap-4">
          {connectors.map((connector, i) => {
            const connection = connectionFor(connector.provider);
            const status: ConnectionStatus = connection?.status ?? "disconnected";
            const meta = STATUS_META[status];
            const Icon = ICONS[connector.icon] ?? Plug;
            const isBusy = busy === connector.provider;
            const blockedByVault = connector.capabilities.oauth && !vaultReady;
            const unavailable = !connector.configured || blockedByVault;

            return (
              <div
                key={connector.provider}
                className="widget p-5 flex flex-col animate-fade-up transition-all duration-300 ease-smooth hover:shadow-widget-lg"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-chimera-clay" />
                  </div>
                  <span
                    className={`u-label inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 ${meta.chip}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-foreground tracking-tight">
                    {connector.label}
                  </h3>
                  {connector.capabilities.demo && (
                    <span className="u-label rounded-pill bg-chimera-gold/15 text-chimera-gold px-2 py-0.5">
                      Demo
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  {connector.description}
                </p>

                {connection?.account_label && (
                  <p className="text-xs text-muted-foreground mb-2 truncate">
                    <span className="u-label text-muted-foreground/70">Account · </span>
                    {connection.account_label}
                  </p>
                )}

                {connection?.last_synced_at && status === "connected" && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Last synced {relativeTime(connection.last_synced_at)}
                  </p>
                )}

                {connection?.last_error && status !== "connected" && (
                  <p className="text-xs text-destructive mb-2 line-clamp-2">
                    {connection.last_error}
                  </p>
                )}

                {/* Never a dead end: say exactly what is missing. */}
                {!connector.configured && (
                  <div className="flex items-start gap-2 rounded-2xl bg-secondary/60 px-3 py-2.5 mb-3">
                    <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                    <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">
                      Needs{" "}
                      {connector.missing_env.map((v, idx) => (
                        <span key={v}>
                          {idx > 0 && ", "}
                          <code className="font-mono bg-card px-1 py-0.5 rounded">{v}</code>
                        </span>
                      ))}{" "}
                      in <span className="font-mono">backend/.env</span>.
                    </p>
                  </div>
                )}

                {/* CalDAV credential form, revealed inline. */}
                {caldavFor === connector.provider && (
                  <CalDavForm
                    busy={isBusy}
                    onCancel={() => setCaldavFor(null)}
                    onSubmit={(config, secret) => connect(connector, { config, secret })}
                  />
                )}

                <div className="flex-1" />

                {caldavFor !== connector.provider && (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    {status === "disconnected" ? (
                      <button
                        type="button"
                        disabled={isBusy || unavailable}
                        onClick={() => connect(connector)}
                        className="inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-xs font-medium bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plug className="w-3.5 h-3.5" />
                        )}
                        Connect
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => connection && syncNow(connection)}
                          className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-xs font-medium border border-border hover:bg-secondary transition-colors disabled:opacity-60"
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3.5 h-3.5" />
                          )}
                          Sync now
                        </button>
                        {(status === "expired" || status === "error") && (
                          <button
                            type="button"
                            disabled={isBusy || unavailable}
                            onClick={() => connect(connector)}
                            className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-xs font-medium bg-chimera-clay text-chimera-cream transition-all hover:brightness-105 disabled:opacity-40"
                          >
                            Reconnect
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => connection && disconnect(connection)}
                          aria-label={`Disconnect ${connector.label}`}
                          className="inline-flex items-center gap-1.5 rounded-pill px-3 py-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-60"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── CalDAV credential form ───────────────────────────────────────────────────

function CalDavForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (config: Record<string, unknown>, secret: string) => void;
}) {
  const [mode, setMode] = useState<"caldav" | "ics">("caldav");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const inputClass =
    "w-full rounded-2xl border border-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 transition-all focus:outline-none focus:ring-2 focus:ring-chimera-clay/35";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          mode === "ics" ? { ics_url: url } : { caldav_url: url, username },
          mode === "ics" ? "" : password
        );
      }}
      className="flex flex-col gap-2 rounded-2xl bg-secondary/50 border border-border p-3 mb-3 animate-scale-in"
    >
      <div className="flex gap-1.5">
        {(["caldav", "ics"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={[
              "rounded-pill px-3 py-1 text-[0.6875rem] font-medium border transition-colors",
              mode === m
                ? "bg-chimera-clay text-chimera-cream border-transparent"
                : "border-border text-muted-foreground hover:bg-card",
            ].join(" ")}
          >
            {m === "caldav" ? "CalDAV (two-way)" : ".ics feed (read-only)"}
          </button>
        ))}
      </div>

      <input
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={
          mode === "ics"
            ? "https://example.com/calendar.ics"
            : "https://caldav.fastmail.com/dav/calendars/user/…"
        }
        className={inputClass}
      />

      {mode === "caldav" && (
        <>
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            className={inputClass}
          />
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="App password"
            autoComplete="current-password"
            className={inputClass}
          />
          <p className="text-[0.625rem] text-muted-foreground leading-relaxed">
            Stored encrypted at rest. Use an app-specific password, not your
            account password.
          </p>
        </>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-xs font-medium bg-chimera-clay text-chimera-cream transition-all hover:brightness-105 disabled:opacity-60"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Connect
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

/** Compact relative time — "4m ago", "2h ago", "3d ago". */
function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
