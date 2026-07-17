/**
 * Shared API request/response type contracts.
 * Both frontend and backend must conform to these shapes.
 * Generated Supabase types are imported separately from @/types/supabase.
 */

// ─── Creator Context (mirrors backend CreatorContext Pydantic model) ────────

export interface CreatorContext {
  artist_name: string;
  genre: string;
  city: string;
  brand_vibe: string;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  recent_outputs: string[];
}

// ─── Onboarding ────────────────────────────────────────────────────────────

export type CreatorType = "musician" | "influencer" | "video_creator";

export interface ClassifyCreatorRequest {
  description: string; // max 500 chars — enforced by Zod on form
}

export interface ClassifyCreatorResponse {
  creator_type: CreatorType;
  confidence: number;
  reasoning: string;
}

// ─── Post Writing ──────────────────────────────────────────────────────────

export interface CaptionVariant {
  text: string;
  char_count: number;
  hashtags: string[];
}

export interface WriteCapitionsRequest {
  context: string;        // max 2000 chars
  platform: "instagram" | "tiktok";
  creator_context: CreatorContext;
}

export interface WriteCapitionsResponse {
  variants: CaptionVariant[];
}

// ─── Ghostwriting ──────────────────────────────────────────────────────────

export interface LyricLine {
  text: string;
  rhyme_label: string;
  syllable_count: number;
}

export interface LyricSection {
  type: "verse" | "chorus" | "bridge" | "outro" | "intro" | "hook";
  lines: LyricLine[];
}

export interface WriteLyricsRequest {
  session_id: string | null;  // null = new session
  user_message: string;       // max 8000 chars
  genre: string;
  theme: string;
  rhyme_scheme: string;       // e.g. "ABAB", "AABB"
  target_section: "verse" | "chorus" | "bridge";
  creator_context: CreatorContext;
}

export interface WriteLyricsResponse {
  session_id: string;
  sections: LyricSection[];
  assistant_message: string;
}

// ─── Visual Design ─────────────────────────────────────────────────────────

export interface BuildImageBriefRequest {
  user_brief: string;         // max 2000 chars
  variant: "promo" | "album_cover";
  creator_context: CreatorContext;
}

export interface BuildImageBriefResponse {
  sd_prompt: string;
  image_url: string | null;   // null while generating; poll or stream
  image_storage_path: string | null;
}

// ─── Personal Manager ──────────────────────────────────────────────────────

export interface DraftOutreachDmRequest {
  venue_or_promoter: string;  // max 500 chars
  event_type: string;         // e.g. "open-mic night", "festival slot"
  creator_context: CreatorContext;
}

export interface DraftOutreachDmResponse {
  draft_message: string;
  char_count: number;
}

export interface RankConcertsRequest {
  city: string;
  genre: string;
  radius_km: number;
  creator_context: CreatorContext;
}

export interface ConcertOpportunity {
  name: string;
  venue: string;
  date: string;
  url: string;
  granite_annotation: string;
}

export interface RankConcertsResponse {
  opportunities: ConcertOpportunity[];
}

// ─── Generic API error shape ────────────────────────────────────────────────

export interface ApiError {
  error: string;
  detail?: string;
}
