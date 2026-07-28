/**
 * Server-side helper for calling the FastAPI backend.  SERVER ONLY.
 *
 * Every Manager Route Handler proxies through here so the service-token
 * plumbing, the misconfiguration check, and the network-failure shape exist in
 * exactly one place. Before this, each route re-implemented the same 30 lines
 * and could drift.
 *
 * The browser never talks to FastAPI, and CHIMERA_SERVICE_TOKEN never leaves
 * the server (CONVENTIONS.md §1).
 */
import "server-only";

export interface BackendResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

/**
 * Call a FastAPI endpoint with the service token attached.
 *
 * Never throws: transport failures come back as ok:false with a 502, so a
 * Route Handler can always return a clean JSON body instead of a Next.js
 * error page.
 */
export async function callBackend<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}
): Promise<BackendResult<T>> {
  const base = process.env.FASTAPI_INTERNAL_URL;
  const token = process.env.CHIMERA_SERVICE_TOKEN;

  if (!base || !token) {
    return {
      ok: false,
      status: 500,
      data: null,
      error:
        "Server misconfiguration: FASTAPI_INTERNAL_URL or CHIMERA_SERVICE_TOKEN is not set.",
    };
  }

  const url = new URL(`${base.replace(/\/$/, "")}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // Integration state changes constantly; a cached connection list would
      // show a stale "connected" badge after a disconnect.
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      data: null,
      error: `Could not reach the Chimera service: ${String(err)}`,
    };
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    // FastAPI puts its message in `detail`; fall back to the raw body so an
    // unexpected error shape is still surfaced rather than swallowed.
    const detail =
      (parsed as { detail?: string } | null)?.detail ?? text.slice(0, 300) ?? "";
    return { ok: false, status: response.status, data: null, error: detail };
  }

  return { ok: true, status: response.status, data: parsed as T };
}
