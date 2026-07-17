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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      creator_type_enum: "musician" | "influencer" | "video_creator";
    };
  };
}
