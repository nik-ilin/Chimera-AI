/**
 * POST /api/connections/[id]/sync — force a sync now.
 *
 * The scheduled path runs on backoff; this is the "Sync now" button, so the
 * user never has to wait for a tick to see fresh data.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { callBackend } from "@/lib/backend";

const IdSchema = z.string().uuid();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await callBackend<Record<string, unknown>>(
    `/api/connections/${id}/sync`,
    { method: "POST", body: { user_id: session.user.id } }
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Sync failed." },
      { status: result.status }
    );
  }

  // The engine reports connector-level failures in the BODY with ok:false
  // rather than as an HTTP error, so a broken integration doesn't look like a
  // broken request. Pass that through verbatim for the UI to render.
  return NextResponse.json(result.data);
}
