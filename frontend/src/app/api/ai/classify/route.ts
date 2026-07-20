/**
 * POST /api/ai/classify
 *
 * Route Handler: validates session, attaches service token, proxies to
 * FastAPI /api/classify. Returns JSON directly (no streaming needed for
 * classification — it's a single fast response).
 *
 * Security: browser never calls FastAPI. Token stays server-side.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";

const RequestSchema = z.object({
  description: z.string().min(1).max(500),
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

  let resp: Response;
  try {
    resp = await fetch(`${fastapiUrl}/api/classify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify(parsed.data),
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

  const data = await resp.json();
  return NextResponse.json(data);
}
