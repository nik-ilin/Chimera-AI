/**
 * Supabase generated TypeScript types.
 *
 * Phase 1 scaffold — matches the initial Supabase schema migration.
 * Regenerate after each schema change with:
 *   npx supabase gen types typescript --project-id <your-project-id> > src/types/supabase.ts
 *
 * Until Supabase CLI is set up, these types are hand-authored to match
 * the SQL migration in /backend/db/migrations/001_initial_schema.sql.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      user_profile: {
        Row: {
          id: string;
          user_id: string;
          artist_name: string;
          genre: string;
          city: string;
          brand_vibe: string;
          instagram_handle: string | null;
          tiktok_handle: string | null;
          recent_outputs: string[];
          creator_type: "musician" | "influencer" | "video_creator" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          artist_name?: string;
          genre?: string;
          city?: string;
          brand_vibe?: string;
          instagram_handle?: string | null;
          tiktok_handle?: string | null;
          recent_outputs?: string[];
          creator_type?: "musician" | "influencer" | "video_creator" | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          artist_name?: string;
          genre?: string;
          city?: string;
          brand_vibe?: string;
          instagram_handle?: string | null;
          tiktok_handle?: string | null;
          recent_outputs?: string[];
          creator_type?: "musician" | "influencer" | "video_creator" | null;
          updated_at?: string;
        };
      };
      /** Migration 006 — Personal Manager calendar. */
      events: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          event_type: EventType;
          /** ISO 8601 UTC instant. */
          starts_at: string;
          ends_at: string | null;
          all_day: boolean;
          location: string;
          notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          event_type?: EventType;
          starts_at: string;
          ends_at?: string | null;
          all_day?: boolean;
          location?: string;
          notes?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          event_type?: EventType;
          starts_at?: string;
          ends_at?: string | null;
          all_day?: boolean;
          location?: string;
          notes?: string;
          updated_at?: string;
        };
      };
      /** Migration 006 — opportunities bookmarked from the finder (Block B2). */
      saved_opportunities: {
        Row: {
          id: string;
          user_id: string;
          source: string;
          source_id: string;
          name: string;
          payload: Json;
          fit_score: number;
          fit_reason: string;
          draft_message: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source?: string;
          source_id: string;
          name: string;
          payload?: Json;
          fit_score?: number;
          fit_reason?: string;
          draft_message?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          payload?: Json;
          fit_score?: number;
          fit_reason?: string;
          draft_message?: string;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      creator_type_enum: "musician" | "influencer" | "video_creator";
      event_type_enum: EventType;
    };
  };
}

/** Calendar event kinds. Mirrors event_type_enum in migration 006. */
export type EventType = "gig" | "release" | "rehearsal" | "deadline" | "other";

/** Convenience aliases so callers don't spell out the Database<…> path. */
export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];
export type EventUpdate = Database["public"]["Tables"]["events"]["Update"];
export type SavedOpportunityRow =
  Database["public"]["Tables"]["saved_opportunities"]["Row"];
