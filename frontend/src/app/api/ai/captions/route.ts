/**
 * POST /api/ai/captions
 *
 * Next.js Route Handler — the ONLY entry point the browser calls for caption
 * generation. Attaches CHIMERA_SERVICE_TOKEN server-side, validates the session,
 * proxies to FastAPI, and streams the JSON response token-by-token so the UI
 * can show progressive output.
 *
 * Security (CONVENTIONS.md §1):
 * - Session validated before any outbound call.
 * - CHIMERA_SERVICE_TOKEN never leaves the server.
 * - Browser talks only to /api/ai/captions — never to FastAPI directly.
 *
 * Streaming strategy:
 * FastAPI returns the full JSON in one shot (no SSE from backend yet).
 * We proxy the response as a streaming text/event-stream so the browser
 * receives a single "result" event with the complete payload, giving us
 * the SSE wire format ready for a streaming upgrade in Phase 4+.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";

const RequestSchema = z.object({
  context: z.string().min(1).max(2000),
  platform: z.enum(["instagram", "tiktok"]).default("instagram"),
  n_variants: z.number().int().min(1).max(5).default(3),
  creator_context: z
    .object({
      artist_name: z.string().max(200).default(""),
      genre: z.string().max(100).default(""),
      city: z.string().max(100).default(""),
      brand_vibe: z.string().max(500).default(""),
      instagram_handle: z.string().max(100).nullable().default(null),
      tiktok_handle: z.string().max(100).nullable().default(null),
      recent_outputs: z.array(z.string()).default([]),
    })
    .default({
      artist_name: "",
      genre: "",
      city: "",
      brand_vibe: "",
      instagram_handle: null,
      tiktok_handle: null,
      recent_outputs: [],
    }),
});

export async function POST(request: Request) {
  // ── Auth guard ──────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse + validate input ──────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", detail: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const fastapiUrl = process.env.FASTAPI_INTERNAL_URL;
  const serviceToken = process.env.CHIMERA_SERVICE_TOKEN;

  if (!fastapiUrl || !serviceToken) {
    return NextResponse.json(
      { error: "Server misconfiguration: FASTAPI_INTERNAL_URL or CHIMERA_SERVICE_TOKEN not set." },
      { status: 500 }
    );
  }

  // ── Proxy to FastAPI with service token ─────────────────────────────────────
  let fastapiResponse: Response;
  try {
    fastapiResponse = await fetch(`${fastapiUrl}/api/captions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach AI service. Is FastAPI running?", detail: String(err) },
      { status: 502 }
    );
  }

  if (!fastapiResponse.ok) {
    const errText = await fastapiResponse.text();
    return NextResponse.json(
      { error: "AI service error", detail: errText },
      { status: fastapiResponse.status }
    );
  }

  // ── Stream the response as Server-Sent Events ────────────────────────────────
  // FastAPI returns one JSON payload. We emit it as a single SSE event so the
  // browser can use the EventSource / ReadableStream pattern, and the wire
  // format is ready for a real streaming upgrade when FastAPI adds SSE.
  const data = await fastapiResponse.json();

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      // SSE format: "data: <payload>\n\n"
      controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
