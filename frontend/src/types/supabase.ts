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
          // ── Gig-hub columns (migration 007) ──
          venue_id: string | null;
          promoter_id: string | null;
          fee_cents: number;
          currency: string;
          gig_status: GigStatus;
          setlist: string;
          rider: string;
          tour_id: string | null;
          source_connection_id: string | null;
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
          venue_id?: string | null;
          promoter_id?: string | null;
          fee_cents?: number;
          currency?: string;
          gig_status?: GigStatus;
          setlist?: string;
          rider?: string;
          tour_id?: string | null;
          source_connection_id?: string | null;
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
          venue_id?: string | null;
          promoter_id?: string | null;
          fee_cents?: number;
          currency?: string;
          gig_status?: GigStatus;
          setlist?: string;
          rider?: string;
          tour_id?: string | null;
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

      // ─── Migration 007: connector layer + canonical entities ───────────────

      /** One row per (user, provider). Metadata only — tokens live elsewhere. */
      connections: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          status: ConnectionStatus;
          account_label: string;
          scopes: string[];
          last_synced_at: string | null;
          sync_cursor: string;
          last_error: string;
          consecutive_failures: number;
          config: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: string;
          status?: ConnectionStatus;
          account_label?: string;
          scopes?: string[];
          config?: Json;
        };
        Update: {
          status?: ConnectionStatus;
          account_label?: string;
          last_synced_at?: string | null;
          sync_cursor?: string;
          last_error?: string;
          consecutive_failures?: number;
          config?: Json;
        };
      };

      venues: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          address: string;
          city: string;
          country: string;
          lat: number | null;
          lon: number | null;
          capacity: number | null;
          website: string;
          notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          address?: string;
          city?: string;
          country?: string;
          lat?: number | null;
          lon?: number | null;
          capacity?: number | null;
          website?: string;
          notes?: string;
        };
        Update: {
          name?: string;
          address?: string;
          city?: string;
          country?: string;
          lat?: number | null;
          lon?: number | null;
          capacity?: number | null;
          website?: string;
          notes?: string;
        };
      };

      contacts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          role: ContactRole;
          organisation: string;
          email: string;
          phone: string;
          notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          role?: ContactRole;
          organisation?: string;
          email?: string;
          phone?: string;
          notes?: string;
        };
        Update: {
          name?: string;
          role?: ContactRole;
          organisation?: string;
          email?: string;
          phone?: string;
          notes?: string;
        };
      };

      bookings: {
        Row: {
          id: string;
          user_id: string;
          event_id: string | null;
          kind: BookingKind;
          status: BookingStatus;
          name: string;
          address: string;
          lat: number | null;
          lon: number | null;
          check_in: string | null;
          check_out: string | null;
          reference: string;
          cost_cents: number;
          currency: string;
          url: string;
          notes: string;
          payload: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_id?: string | null;
          kind?: BookingKind;
          status?: BookingStatus;
          name: string;
          address?: string;
          lat?: number | null;
          lon?: number | null;
          check_in?: string | null;
          check_out?: string | null;
          reference?: string;
          cost_cents?: number;
          currency?: string;
          url?: string;
          notes?: string;
          payload?: Json;
        };
        Update: {
          event_id?: string | null;
          kind?: BookingKind;
          status?: BookingStatus;
          name?: string;
          address?: string;
          check_in?: string | null;
          check_out?: string | null;
          reference?: string;
          cost_cents?: number;
          notes?: string;
        };
      };

      releases: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          kind: ReleaseKind;
          release_date: string | null;
          label: string;
          artwork_url: string;
          tracks: Json;
          notes: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          kind?: ReleaseKind;
          release_date?: string | null;
          label?: string;
          artwork_url?: string;
          tracks?: Json;
          notes?: string;
        };
        Update: {
          title?: string;
          kind?: ReleaseKind;
          release_date?: string | null;
          label?: string;
          notes?: string;
        };
      };

      expenses: {
        Row: {
          id: string;
          user_id: string;
          event_id: string | null;
          booking_id: string | null;
          kind: ExpenseKind;
          description: string;
          /** Signed minor units: positive = money in, negative = money out. */
          amount_cents: number;
          currency: string;
          incurred_on: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_id?: string | null;
          booking_id?: string | null;
          kind?: ExpenseKind;
          description?: string;
          amount_cents?: number;
          currency?: string;
          incurred_on?: string;
        };
        Update: {
          kind?: ExpenseKind;
          description?: string;
          amount_cents?: number;
          incurred_on?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      creator_type_enum: "musician" | "influencer" | "video_creator";
      event_type_enum: EventType;
      connection_status_enum: ConnectionStatus;
      booking_kind_enum: BookingKind;
      booking_status_enum: BookingStatus;
      expense_kind_enum: ExpenseKind;
    };
  };
}

/** Calendar event kinds. Mirrors event_type_enum in migration 006. */
export type EventType = "gig" | "release" | "rehearsal" | "deadline" | "other";

// ─── Migration 007 enums (kept in sync with the SQL by hand) ─────────────────

/** Lifecycle of a gig, from first enquiry through settlement. */
export type GigStatus = "enquiry" | "held" | "confirmed" | "settled" | "cancelled";

/** Live health of an integration, shown on the connection card. */
export type ConnectionStatus =
  | "disconnected"
  | "connected"
  | "error"
  | "expired"
  | "syncing";

export type BookingKind = "accommodation" | "travel" | "backline" | "other";
export type BookingStatus = "option" | "confirmed" | "cancelled";
export type ContactRole =
  | "promoter"
  | "booker"
  | "venue"
  | "agency"
  | "press"
  | "crew"
  | "other";
export type ReleaseKind = "single" | "ep" | "album" | "video";
export type ExpenseKind =
  | "fee_in"
  | "travel"
  | "accommodation"
  | "crew"
  | "gear"
  | "marketing"
  | "other";

/** Convenience aliases so callers don't spell out the Database<…> path. */
export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];
export type EventUpdate = Database["public"]["Tables"]["events"]["Update"];
export type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
export type VenueRow = Database["public"]["Tables"]["venues"]["Row"];
export type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
export type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];
export type ReleaseRow = Database["public"]["Tables"]["releases"]["Row"];
export type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
export type SavedOpportunityRow =
  Database["public"]["Tables"]["saved_opportunities"]["Row"];
