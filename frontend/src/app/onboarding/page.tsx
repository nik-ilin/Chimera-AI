/**
 * Onboarding router — Server Component wrapper.
 *
 * "What is your profile?" — the user describes what they do, the AI classifies
 * them (classify_creator task), the result is persisted to user_profile, and
 * Musicians are routed into their portal. Influencer / Video Creator are
 * visible but locked (later phases).
 *
 * If the user already has a creator_type, skip straight to the portal.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/onboarding");
  }

  // Already classified? Go straight to the portal (musician is the only
  // active portal in this phase).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: profile } = await supabase
    .from("user_profile")
    .select("creator_type")
    .eq("user_id", session.user.id)
    .single();

  if (profile?.creator_type === "musician") {
    redirect("/portal/musician");
  }

  return <OnboardingClient />;
}
