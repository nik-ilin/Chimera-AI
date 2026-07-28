/**
 * /api/contacts — promoters, bookers, venue staff, press, crew.
 *
 * Like venues, contacts are created inline from the gig hub, so POST can attach
 * the new contact as the gig's promoter in the same request.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ContactRow } from "@/types/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CreateContactSchema = z.object({
  name: z.string().trim().min(1, "Give the contact a name.").max(200),
  role: z
    .enum(["promoter", "booker", "venue", "agency", "press", "crew", "other"])
    .default("promoter"),
  organisation: z.string().trim().max(200).default(""),
  // Not .email(): a half-entered contact is normal while a gig is still an
  // enquiry, and blocking the save over a missing address is hostile.
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(60).default(""),
  notes: z.string().trim().max(2000).default(""),
  /** When present, the new contact becomes this gig's promoter. */
  attach_to_event_id: z.string().uuid().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", session.user.id)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load contacts", detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ contacts: (data ?? []) as ContactRow[] });
}

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

  const parsed = CreateContactSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { attach_to_event_id: attachTo, ...contact } = parsed.data;
  const supabase = (await createClient()) as any;

  const { data, error } = await supabase
    .from("contacts")
    .insert({ ...contact, user_id: session.user.id })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create contact", detail: error.message },
      { status: 500 }
    );
  }

  if (attachTo) {
    await supabase
      .from("events")
      .update({ promoter_id: (data as ContactRow).id })
      .eq("id", attachTo)
      .eq("user_id", session.user.id);
  }

  return NextResponse.json(data as ContactRow, { status: 201 });
}
