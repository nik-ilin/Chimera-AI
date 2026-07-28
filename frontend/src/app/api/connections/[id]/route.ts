/**
 * /api/connections/[id] — disconnect an integration.
 *
 * Disconnecting forgets the tokens but KEEPS events already imported; they
 * simply lose their source link. A user unplugging Google Calendar should not
 * watch their gigs disappear.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { callBackend } from "@/lib/backend";

const IdSchema = z.string().uuid();

export async function DELETE(
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

  const result = await callBackend(`/api/connections/${id}`, {
    method: "DELETE",
    query: { user_id: session.user.id },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Could not disconnect." },
      { status: result.status }
    );
  }

  return NextResponse.json({ ok: true });
}
