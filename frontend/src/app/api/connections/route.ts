/**
 * /api/connections — list the caller's integrations, or start a new connection.
 *
 * Security: user_id is taken from the verified session and passed to FastAPI.
 * The client cannot name a different user, and FastAPI re-checks ownership on
 * every mutation because it holds the service-role key and therefore bypasses
 * RLS (see routes/connections.py).
 *
 * Nothing here ever returns a token: they live in connection_secrets, which the
 * list endpoint does not query.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { callBackend } from "@/lib/backend";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Catalogue and connections together: the UI needs both to render a card per
  // available provider with the user's live status merged in, and two
  // round-trips would make the page pop in twice.
  const [catalogue, connections] = await Promise.all([
    callBackend<{ connectors: unknown[]; vault_ready: boolean }>(
      "/api/connections/catalogue"
    ),
    callBackend<{ connections: unknown[] }>("/api/connections", {
      query: { user_id: session.user.id },
    }),
  ]);

  if (!catalogue.ok) {
    return NextResponse.json(
      { error: catalogue.error ?? "Could not load the connector catalogue." },
      { status: catalogue.status }
    );
  }

  return NextResponse.json({
    connectors: catalogue.data?.connectors ?? [],
    vaultReady: catalogue.data?.vault_ready ?? false,
    // A failed connections read is not fatal — the catalogue alone still lets
    // the user connect something.
    connections: connections.ok ? (connections.data?.connections ?? []) : [],
    connectionsError: connections.ok ? null : connections.error,
  });
}

const ConnectSchema = z.object({
  provider: z.string().min(1).max(60),
  config: z.record(z.string(), z.unknown()).default({}),
  /** CalDAV password. Encrypted server-side immediately; never stored raw. */
  secret: z.string().max(500).default(""),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ConnectSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", detail: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const result = await callBackend<{ mode: string; authorize_url?: string }>(
    "/api/connections/connect",
    {
      method: "POST",
      body: { user_id: session.user.id, ...parsed.data },
    }
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Could not start the connection." },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}
