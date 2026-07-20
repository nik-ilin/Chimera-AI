/**
 * POST /api/ai/ghostwrite
 *
 * Route Handler: validates session, injects user_id from session, attaches
 * service token, proxies to FastAPI /api/ghostwrite.
 * Streams the SSE response through to the browser.
 *
 * Security: browser never calls FastAPI. Token stays server-side.
 */
export const dynamic = "force-dynamic";
// Allow long, slow generations to stream without being killed mid-stream.
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";

const SectionType = z.enum(["verse", "chorus", "bridge", "intro", "outro", "hook"]);

const RequestSchema = z.object({
  session_id: z.string().uuid().nullable().default(null),
  user_message: z.string().min(1).max(8000),
  genre: z.string().max(100).default("pop"),
  theme: z.string().max(500).default(""),
  rhyme_scheme: z.string().max(20).default("ABAB"),
  target_section: SectionType.default("verse"),
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
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  // Inject the authenticated user_id so the backend can write to lyric_sessions
  const payload = {
    ...parsed.data,
    user_id: session.user.id,
  };

  let resp: Response;
  try {
    resp = await fetch(`${fastapiUrl}/api/ghostwrite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach AI service", detail: String(err) },
      { status: 502 }
    );
  }

  if (!resp.ok) {
    const errText = await resp.text();
    return NextResponse.json({ error: "AI service error", detail: errText }, { status: resp.status });
  }

  // Pipe the backend SSE stream straight through, unbuffered, so session /
  // token / result events reach the client as they are produced.
  return new Response(resp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
