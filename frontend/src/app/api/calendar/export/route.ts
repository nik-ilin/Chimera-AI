/**
 * GET /api/calendar/export — download the caller's calendar as .ics
 *
 * Proxies to FastAPI, which owns the RFC 5545 serialiser
 * (services/connectors/ics.py). Keeping ONE codec avoids two implementations
 * that must agree — the kind of duplication that drifts until a calendar app
 * rejects the feed.
 *
 * Returns the file with a Content-Disposition so the browser downloads it, and
 * no-store so a subscribed client always sees live data.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const base = process.env.FASTAPI_INTERNAL_URL;
  const token = process.env.CHIMERA_SERVICE_TOKEN;
  if (!base || !token) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  // Not routed through callBackend(): that helper parses JSON, and this
  // endpoint returns text/calendar.
  const url = new URL(`${base.replace(/\/$/, "")}/api/calendar/export`);
  url.searchParams.set("user_id", session.user.id);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach the Chimera service", detail: String(err) },
      { status: 502 }
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: "Export failed", detail: (await response.text()).slice(0, 300) },
      { status: response.status }
    );
  }

  const body = await response.text();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="chimera-calendar.ics"',
      "Cache-Control": "no-store",
    },
  });
}
