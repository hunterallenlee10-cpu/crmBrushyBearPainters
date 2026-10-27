export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: string;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          display_name: string;
          id: string;
          is_referral_champion: boolean;
          notes: string | null;
          org_id: string;
          owner_id: string | null;
          primary_contact_id: string | null;
          search_text: string | null;
          status: string;
          tags: string[];
          territory_id: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_type?: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          display_name: string;
          id?: string;
          is_referral_champion?: boolean;
          notes?: string | null;
          org_id: string;
          owner_id?: string | null;
          primary_contact_id?: string | null;
          search_text?: never;
          status?: string;
          tags?: string[];
          territory_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          account_type?: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          display_name?: string;
          id?: string;
          is_referral_champion?: boolean;
          notes?: string | null;
          org_id?: string;
          owner_id?: string | null;
          primary_contact_id?: string | null;
          search_text?: never;
          status?: string;
          tags?: string[];
          territory_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "accounts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "accounts_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "accounts_primary_contact_fk";
            columns: ["primary_contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "accounts_territory_id_fkey";
            columns: ["territory_id"];
            isOneToOne: false;
            referencedRelation: "territories";
            referencedColumns: ["id"];
          },
        ];
      };
      activity: {
        Row: {
          actor_id: string | null;
          created_at: string;
          id: string;
          impersonated_by: string | null;
          org_id: string;
          payload: NonNullable<Json>;
          subject_id: string;
          subject_type: string;
          summary: string;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          impersonated_by?: string | null;
          org_id: string;
          payload?: NonNullable<Json>;
          subject_id: string;
          subject_type: string;
          summary: string;
          type: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          impersonated_by?: string | null;
          org_id?: string;
          payload?: NonNullable<Json>;
          subject_id?: string;
          subject_type?: string;
          summary?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      appointments: {
        Row: {
          all_day: boolean;
          assigned_user_ids: string[];
          canceled_reason: string | null;
          completed_at: string | null;
          confirmed_at: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          ends_at: string;
          external_calendar_event_id: string | null;
          id: string;
          job_id: string | null;
          lead_id: string | null;
          location: string | null;
          notes: string | null;
          org_id: string;
          reminders: NonNullable<Json>;
          result: string | null;
          starts_at: string;
          status: string;
          title: string | null;
          type: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          all_day?: boolean;
          assigned_user_ids?: string[];
          canceled_reason?: string | null;
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          ends_at: string;
          external_calendar_event_id?: string | null;
          id?: string;
          job_id?: string | null;
          lead_id?: string | null;
          location?: string | null;
          notes?: string | null;
          org_id: string;
          reminders?: NonNullable<Json>;
          result?: string | null;
          starts_at: string;
          status?: string;
          title?: string | null;
          type: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          all_day?: boolean;
          assigned_user_ids?: string[];
          canceled_reason?: string | null;
          completed_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          ends_at?: string;
          external_calendar_event_id?: string | null;
          id?: string;
          job_id?: string | null;
          lead_id?: string | null;
          location?: string | null;
          notes?: string | null;
          org_id?: string;
          reminders?: NonNullable<Json>;
          result?: string | null;
          starts_at?: string;
          status?: string;
          title?: string | null;
          type?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "appointments_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      approval_requests: {
        Row: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          id: string;
          job_id: string;
          org_id: string;
          payload: NonNullable<Json>;
          reason: string;
          requested_at: string;
          requested_by: string;
          status: string;
          type: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          id?: string;
          job_id: string;
          org_id: string;
          payload?: NonNullable<Json>;
          reason: string;
          requested_at?: string;
          requested_by: string;
          status?: string;
          type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          id?: string;
          job_id?: string;
          org_id?: string;
          payload?: NonNullable<Json>;
          reason?: string;
          requested_at?: string;
          requested_by?: string;
          status?: string;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approval_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_requests_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      attention_items: {
        Row: {
          category: string;
          condition_cleared_at: string | null;
          created_at: string;
          dedupe_key: string;
          detail: string | null;
          due_at: string | null;
          id: string;
          last_seen_at: string;
          opened_at: string;
          org_id: string;
          owner_id: string | null;
          priority: string;
          resolution: string | null;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          rule_key: string;
          snoozed_until: string | null;
          status: string;
          subject_id: string;
          subject_type: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          condition_cleared_at?: string | null;
          created_at?: string;
          dedupe_key: string;
          detail?: string | null;
          due_at?: string | null;
          id?: string;
          last_seen_at?: string;
          opened_at?: string;
          org_id: string;
          owner_id?: string | null;
          priority: string;
          resolution?: string | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          rule_key: string;
          snoozed_until?: string | null;
          status?: string;
          subject_id: string;
          subject_type: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          condition_cleared_at?: string | null;
          created_at?: string;
          dedupe_key?: string;
          detail?: string | null;
          due_at?: string | null;
          id?: string;
          last_seen_at?: string;
          opened_at?: string;
          org_id?: string;
          owner_id?: string | null;
          priority?: string;
          resolution?: string | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          rule_key?: string;
          snoozed_until?: string | null;
          status?: string;
          subject_id?: string;
          subject_type?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attention_items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attention_items_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      attention_rules: {
        Row: {
          created_at: string;
          created_by: string | null;
          enabled: boolean;
          org_id: string;
          rule_key: string;
          thresholds: NonNullable<Json>;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          org_id: string;
          rule_key: string;
          thresholds?: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          enabled?: boolean;
          org_id?: string;
          rule_key?: string;
          thresholds?: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attention_rules_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          after: Json | null;
          at: string;
          before: Json | null;
          changed_fields: string[] | null;
          id: number;
          impersonated_by: string | null;
          ip: unknown;
          org_id: string | null;
          record_id: string | null;
          request_id: string | null;
          table_name: string;
          user_agent: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          changed_fields?: string[] | null;
          id?: never;
          impersonated_by?: string | null;
          ip?: unknown;
          org_id?: string | null;
          record_id?: string | null;
          request_id?: string | null;
          table_name: string;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          after?: Json | null;
          at?: string;
          before?: Json | null;
          changed_fields?: string[] | null;
          id?: never;
          impersonated_by?: string | null;
          ip?: unknown;
          org_id?: string | null;
          record_id?: string | null;
          request_id?: string | null;
          table_name?: string;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          body: string;
          category: string;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          edited_at: string | null;
          id: string;
          mentions: string[];
          org_id: string;
          subject_id: string;
          subject_type: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          mentions?: string[];
          org_id: string;
          subject_id: string;
          subject_type: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          body?: string;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          edited_at?: string | null;
          id?: string;
          mentions?: string[];
          org_id?: string;
          subject_id?: string;
          subject_type?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "comments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      company_settings: {
        Row: {
          auto_convert_on_walkthrough: boolean;
          business_hours: NonNullable<Json>;
          company_name: string;
          created_at: string;
          created_by: string | null;
          deposit_percent: number;
          email: string;
          estimate_expiry_days: number;
          estimate_sla_hours: number;
          estimate_sla_warn_hours: number;
          exterior_season_end: string;
          exterior_season_start: string;
          hours_text: string;
          id: string;
          lni_number: string;
          logo_path: string | null;
          on_time_guarantee_cents: number;
          org_id: string;
          phone: string;
          referral_reward_cents: number | null;
          review_link: string | null;
          rrp_firm_cert_expires_on: string | null;
          rrp_firm_certification: string | null;
          service_area_note: string | null;
          tagline: string | null;
          tax_config: NonNullable<Json>;
          text_back_sla_minutes: number;
          ubi_number: string;
          updated_at: string;
          updated_by: string | null;
          website_url: string | null;
        };
        ComputedFields: never;
        Insert: {
          auto_convert_on_walkthrough?: boolean;
          business_hours?: NonNullable<Json>;
          company_name?: string;
          created_at?: string;
          created_by?: string | null;
          deposit_percent?: number;
          email?: string;
          estimate_expiry_days?: number;
          estimate_sla_hours?: number;
          estimate_sla_warn_hours?: number;
          exterior_season_end?: string;
          exterior_season_start?: string;
          hours_text?: string;
          id?: string;
          lni_number?: string;
          logo_path?: string | null;
          on_time_guarantee_cents?: number;
          org_id: string;
          phone?: string;
          referral_reward_cents?: number | null;
          review_link?: string | null;
          rrp_firm_cert_expires_on?: string | null;
          rrp_firm_certification?: string | null;
          service_area_note?: string | null;
          tagline?: string | null;
          tax_config?: NonNullable<Json>;
          text_back_sla_minutes?: number;
          ubi_number?: string;
          updated_at?: string;
          updated_by?: string | null;
          website_url?: string | null;
        };
        Update: {
          auto_convert_on_walkthrough?: boolean;
          business_hours?: NonNullable<Json>;
          company_name?: string;
          created_at?: string;
          created_by?: string | null;
          deposit_percent?: number;
          email?: string;
          estimate_expiry_days?: number;
          estimate_sla_hours?: number;
          estimate_sla_warn_hours?: number;
          exterior_season_end?: string;
          exterior_season_start?: string;
          hours_text?: string;
          id?: string;
          lni_number?: string;
          logo_path?: string | null;
          on_time_guarantee_cents?: number;
          org_id?: string;
          phone?: string;
          referral_reward_cents?: number | null;
          review_link?: string | null;
          rrp_firm_cert_expires_on?: string | null;
          rrp_firm_certification?: string | null;
          service_area_note?: string | null;
          tagline?: string | null;
          tax_config?: NonNullable<Json>;
          text_back_sla_minutes?: number;
          ubi_number?: string;
          updated_at?: string;
          updated_by?: string | null;
          website_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "company_settings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          account_id: string;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          do_not_contact: boolean;
          email: string | null;
          email_opt_in: boolean;
          email_opt_in_at: string | null;
          email_opt_in_source: string | null;
          first_name: string;
          id: string;
          language: string;
          last_name: string | null;
          mobile: string | null;
          notes: string | null;
          opted_out_at: string | null;
          org_id: string;
          phone: string | null;
          phone_digits: string | null;
          preferred_channel: string | null;
          role: string;
          search_text: string | null;
          sms_opt_in: boolean;
          sms_opt_in_at: string | null;
          sms_opt_in_source: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_id: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          do_not_contact?: boolean;
          email?: string | null;
          email_opt_in?: boolean;
          email_opt_in_at?: string | null;
          email_opt_in_source?: string | null;
          first_name: string;
          id?: string;
          language?: string;
          last_name?: string | null;
          mobile?: string | null;
          notes?: string | null;
          opted_out_at?: string | null;
          org_id: string;
          phone?: string | null;
          phone_digits?: never;
          preferred_channel?: string | null;
          role?: string;
          search_text?: never;
          sms_opt_in?: boolean;
          sms_opt_in_at?: string | null;
          sms_opt_in_source?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          do_not_contact?: boolean;
          email?: string | null;
          email_opt_in?: boolean;
          email_opt_in_at?: string | null;
          email_opt_in_source?: string | null;
          first_name?: string;
          id?: string;
          language?: string;
          last_name?: string | null;
          mobile?: string | null;
          notes?: string | null;
          opted_out_at?: string | null;
          org_id?: string;
          phone?: string | null;
          phone_digits?: never;
          preferred_channel?: string | null;
          role?: string;
          search_text?: never;
          sms_opt_in?: boolean;
          sms_opt_in_at?: string | null;
          sms_opt_in_source?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          actor_id: string | null;
          aggregate_id: string | null;
          aggregate_type: string;
          attempts: number;
          available_at: string;
          created_at: string;
          id: number;
          idempotency_key: string | null;
          impersonated_by: string | null;
          last_error: string | null;
          locked_at: string | null;
          org_id: string | null;
          payload: NonNullable<Json>;
          processed_at: string | null;
          status: string;
          type: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          aggregate_id?: string | null;
          aggregate_type: string;
          attempts?: number;
          available_at?: string;
          created_at?: string;
          id?: never;
          idempotency_key?: string | null;
          impersonated_by?: string | null;
          last_error?: string | null;
          locked_at?: string | null;
          org_id?: string | null;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          status?: string;
          type: string;
        };
        Update: {
          actor_id?: string | null;
          aggregate_id?: string | null;
          aggregate_type?: string;
          attempts?: number;
          available_at?: string;
          created_at?: string;
          id?: never;
          idempotency_key?: string | null;
          impersonated_by?: string | null;
          last_error?: string | null;
          locked_at?: string | null;
          org_id?: string | null;
          payload?: NonNullable<Json>;
          processed_at?: string | null;
          status?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      intake_requests: {
        Row: {
          created_at: string;
          idempotency_key: string;
          lead_id: string | null;
          org_id: string;
          outcome: string;
          request_hash: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          idempotency_key: string;
          lead_id?: string | null;
          org_id: string;
          outcome: string;
          request_hash: string;
        };
        Update: {
          created_at?: string;
          idempotency_key?: string;
          lead_id?: string | null;
          org_id?: string;
          outcome?: string;
          request_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "intake_requests_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intake_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_connections: {
        Row: {
          config: NonNullable<Json>;
          connected_at: string | null;
          connected_by: string | null;
          created_at: string;
          created_by: string | null;
          domain: string;
          id: string;
          last_error: string | null;
          last_sync_at: string | null;
          notes: string | null;
          org_id: string;
          provider: string;
          status: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          config?: NonNullable<Json>;
          connected_at?: string | null;
          connected_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          domain: string;
          id?: string;
          last_error?: string | null;
          last_sync_at?: string | null;
          notes?: string | null;
          org_id: string;
          provider: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          config?: NonNullable<Json>;
          connected_at?: string | null;
          connected_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          domain?: string;
          id?: string;
          last_error?: string | null;
          last_sync_at?: string | null;
          notes?: string | null;
          org_id?: string;
          provider?: string;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "integration_connections_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_outbox: {
        Row: {
          created_at: string;
          created_by: string | null;
          domain: string;
          error: string | null;
          id: string;
          operation: string;
          org_id: string;
          payload: NonNullable<Json>;
          provider: string;
          recipient: string | null;
          related_id: string | null;
          related_type: string | null;
          rendered_body: string | null;
          status: string;
          subject: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          domain: string;
          error?: string | null;
          id?: string;
          operation: string;
          org_id: string;
          payload?: NonNullable<Json>;
          provider: string;
          recipient?: string | null;
          related_id?: string | null;
          related_type?: string | null;
          rendered_body?: string | null;
          status?: string;
          subject?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          domain?: string;
          error?: string | null;
          id?: string;
          operation?: string;
          org_id?: string;
          payload?: NonNullable<Json>;
          provider?: string;
          recipient?: string | null;
          related_id?: string | null;
          related_type?: string | null;
          rendered_body?: string | null;
          status?: string;
          subject?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "integration_outbox_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_financials: {
        Row: {
          contract_baseline_cents: number | null;
          created_at: string;
          created_by: string | null;
          job_id: string;
          org_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          contract_baseline_cents?: number | null;
          created_at?: string;
          created_by?: string | null;
          job_id: string;
          org_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          contract_baseline_cents?: number | null;
          created_at?: string;
          created_by?: string | null;
          job_id?: string;
          org_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_financials_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_financials_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_holds: {
        Row: {
          blocks_scheduling: boolean;
          created_at: string;
          hold_type: string;
          id: string;
          job_id: string;
          org_id: string;
          placed_at: string;
          placed_by: string | null;
          reason: string;
          release_note: string | null;
          released_at: string | null;
          released_by: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          blocks_scheduling?: boolean;
          created_at?: string;
          hold_type: string;
          id?: string;
          job_id: string;
          org_id: string;
          placed_at?: string;
          placed_by?: string | null;
          reason: string;
          release_note?: string | null;
          released_at?: string | null;
          released_by?: string | null;
          updated_at?: string;
        };
        Update: {
          blocks_scheduling?: boolean;
          created_at?: string;
          hold_type?: string;
          id?: string;
          job_id?: string;
          org_id?: string;
          placed_at?: string;
          placed_by?: string | null;
          reason?: string;
          release_note?: string | null;
          released_at?: string | null;
          released_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_holds_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_holds_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_team: {
        Row: {
          added_at: string;
          added_by: string | null;
          job_id: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          added_at?: string;
          added_by?: string | null;
          job_id: string;
          org_id: string;
          role: string;
          user_id: string;
        };
        Update: {
          added_at?: string;
          added_by?: string | null;
          job_id?: string;
          org_id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_team_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_team_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_team_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          accepted_estimate_id: string | null;
          account_id: string;
          active_hold_count: number;
          actual_start_date: string | null;
          blocking_hold_count: number;
          closed_at: string | null;
          completed_at: string | null;
          contract_signed_at: string | null;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          deposit_paid_at: string | null;
          estimate_accepted_at: string | null;
          estimate_sent_at: string | null;
          estimated_completion_date: string | null;
          estimated_duration_days: number | null;
          final_invoiced_at: string | null;
          final_walkthrough_at: string | null;
          first_contact_at: string | null;
          health_checked_at: string | null;
          health_factors: NonNullable<Json>;
          health_score: number | null;
          id: string;
          is_priority_reschedule: boolean;
          job_number: string;
          lead_created_at: string | null;
          lead_id: string | null;
          lead_source: string | null;
          lead_sub_source: string | null;
          lost_at: string | null;
          lost_reason: string | null;
          name: string;
          on_time_guarantee_status: string;
          onboarding_completed_at: string | null;
          onboarding_started_at: string | null;
          org_id: string;
          owner_id: string | null;
          paid_in_full_at: string | null;
          point_of_contact_id: string | null;
          primary_contact_id: string | null;
          priority: string;
          priority_reason: string | null;
          project_manager_id: string | null;
          promised_start_date: string | null;
          property_id: string | null;
          ready_to_schedule_at: string | null;
          scheduled_at: string | null;
          search_text: string | null;
          stage: string;
          stage_entered_at: string;
          status: string;
          tags: string[];
          target_season: number | null;
          team_user_ids: string[];
          territory_id: string | null;
          updated_at: string;
          updated_by: string | null;
          walkthrough_completed_at: string | null;
          walkthrough_scheduled_at: string | null;
          work_completed_at: string | null;
          work_types: string[];
        };
        ComputedFields: never;
        Insert: {
          accepted_estimate_id?: string | null;
          account_id: string;
          active_hold_count?: number;
          actual_start_date?: string | null;
          blocking_hold_count?: number;
          closed_at?: string | null;
          completed_at?: string | null;
          contract_signed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deposit_paid_at?: string | null;
          estimate_accepted_at?: string | null;
          estimate_sent_at?: string | null;
          estimated_completion_date?: string | null;
          estimated_duration_days?: number | null;
          final_invoiced_at?: string | null;
          final_walkthrough_at?: string | null;
          first_contact_at?: string | null;
          health_checked_at?: string | null;
          health_factors?: NonNullable<Json>;
          health_score?: number | null;
          id?: string;
          is_priority_reschedule?: boolean;
          job_number: string;
          lead_created_at?: string | null;
          lead_id?: string | null;
          lead_source?: string | null;
          lead_sub_source?: string | null;
          lost_at?: string | null;
          lost_reason?: string | null;
          name: string;
          on_time_guarantee_status?: string;
          onboarding_completed_at?: string | null;
          onboarding_started_at?: string | null;
          org_id: string;
          owner_id?: string | null;
          paid_in_full_at?: string | null;
          point_of_contact_id?: string | null;
          primary_contact_id?: string | null;
          priority?: string;
          priority_reason?: string | null;
          project_manager_id?: string | null;
          promised_start_date?: string | null;
          property_id?: string | null;
          ready_to_schedule_at?: string | null;
          scheduled_at?: string | null;
          search_text?: never;
          stage?: string;
          stage_entered_at?: string;
          status?: string;
          tags?: string[];
          target_season?: number | null;
          team_user_ids?: string[];
          territory_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          walkthrough_completed_at?: string | null;
          walkthrough_scheduled_at?: string | null;
          work_completed_at?: string | null;
          work_types?: string[];
        };
        Update: {
          accepted_estimate_id?: string | null;
          account_id?: string;
          active_hold_count?: number;
          actual_start_date?: string | null;
          blocking_hold_count?: number;
          closed_at?: string | null;
          completed_at?: string | null;
          contract_signed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deposit_paid_at?: string | null;
          estimate_accepted_at?: string | null;
          estimate_sent_at?: string | null;
          estimated_completion_date?: string | null;
          estimated_duration_days?: number | null;
          final_invoiced_at?: string | null;
          final_walkthrough_at?: string | null;
          first_contact_at?: string | null;
          health_checked_at?: string | null;
          health_factors?: NonNullable<Json>;
          health_score?: number | null;
          id?: string;
          is_priority_reschedule?: boolean;
          job_number?: string;
          lead_created_at?: string | null;
          lead_id?: string | null;
          lead_source?: string | null;
          lead_sub_source?: string | null;
          lost_at?: string | null;
          lost_reason?: string | null;
          name?: string;
          on_time_guarantee_status?: string;
          onboarding_completed_at?: string | null;
          onboarding_started_at?: string | null;
          org_id?: string;
          owner_id?: string | null;
          paid_in_full_at?: string | null;
          point_of_contact_id?: string | null;
          primary_contact_id?: string | null;
          priority?: string;
          priority_reason?: string | null;
          project_manager_id?: string | null;
          promised_start_date?: string | null;
          property_id?: string | null;
          ready_to_schedule_at?: string | null;
          scheduled_at?: string | null;
          search_text?: never;
          stage?: string;
          stage_entered_at?: string;
          status?: string;
          tags?: string[];
          target_season?: number | null;
          team_user_ids?: string[];
          territory_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          walkthrough_completed_at?: string | null;
          walkthrough_scheduled_at?: string | null;
          work_completed_at?: string | null;
          work_types?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "jobs_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: true;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_point_of_contact_id_fkey";
            columns: ["point_of_contact_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_primary_contact_id_fkey";
            columns: ["primary_contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_project_manager_id_fkey";
            columns: ["project_manager_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_territory_id_fkey";
            columns: ["territory_id"];
            isOneToOne: false;
            referencedRelation: "territories";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_attachments: {
        Row: {
          content_type: string;
          created_at: string;
          created_by: string | null;
          file_name: string;
          id: string;
          lead_id: string;
          org_id: string;
          size_bytes: number;
          source: string;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          content_type: string;
          created_at?: string;
          created_by?: string | null;
          file_name: string;
          id?: string;
          lead_id: string;
          org_id: string;
          size_bytes: number;
          source?: string;
          storage_path: string;
        };
        Update: {
          content_type?: string;
          created_at?: string;
          created_by?: string | null;
          file_name?: string;
          id?: string;
          lead_id?: string;
          org_id?: string;
          size_bytes?: number;
          source?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lead_attachments_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lead_attachments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_scoring_rules: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          factor: string;
          id: string;
          label: string;
          org_id: string;
          points: number;
          sort_order: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          factor: string;
          id?: string;
          label: string;
          org_id: string;
          points: number;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          factor?: string;
          id?: string;
          label?: string;
          org_id?: string;
          points?: number;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lead_scoring_rules_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          account_id: string | null;
          city: string | null;
          company: string | null;
          contact_id: string | null;
          converted_at: string | null;
          converted_job_id: string | null;
          created_at: string;
          created_by: string | null;
          customer_notes: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          disposition: string | null;
          email: string | null;
          first_contacted_at: string | null;
          first_name: string;
          grade: string | null;
          has_hoa: boolean | null;
          home_built: string | null;
          id: string;
          intake_channel: string;
          landing_page: string | null;
          last_activity_at: string;
          last_name: string | null;
          lead_set_by: string | null;
          lead_source: string;
          lead_sub_source: string | null;
          lost_reason: string | null;
          mobile: string | null;
          nurture_until: string | null;
          org_id: string;
          out_of_area: boolean;
          owner_id: string | null;
          page_path: string | null;
          phone: string | null;
          phone_digits: string | null;
          point_of_contact_id: string | null;
          property_id: string | null;
          property_type: string | null;
          referral_code: string | null;
          referrer: string | null;
          score: number | null;
          score_factors: NonNullable<Json>;
          scored_at: string | null;
          search_text: string | null;
          services: string[];
          siding_type: string | null;
          speed_to_lead_seconds: number | null;
          state: string;
          status: string;
          stories: number | null;
          street: string | null;
          temperature: string | null;
          territory_id: string | null;
          timeline: string | null;
          unit: string | null;
          updated_at: string;
          updated_by: string | null;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
          walkthrough_at: string | null;
          year_built: number | null;
          zip: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          city?: string | null;
          company?: string | null;
          contact_id?: string | null;
          converted_at?: string | null;
          converted_job_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_notes?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          disposition?: string | null;
          email?: string | null;
          first_contacted_at?: string | null;
          first_name: string;
          grade?: string | null;
          has_hoa?: boolean | null;
          home_built?: string | null;
          id?: string;
          intake_channel?: string;
          landing_page?: string | null;
          last_activity_at?: string;
          last_name?: string | null;
          lead_set_by?: string | null;
          lead_source: string;
          lead_sub_source?: string | null;
          lost_reason?: string | null;
          mobile?: string | null;
          nurture_until?: string | null;
          org_id: string;
          out_of_area?: boolean;
          owner_id?: string | null;
          page_path?: string | null;
          phone?: string | null;
          phone_digits?: never;
          point_of_contact_id?: string | null;
          property_id?: string | null;
          property_type?: string | null;
          referral_code?: string | null;
          referrer?: string | null;
          score?: number | null;
          score_factors?: NonNullable<Json>;
          scored_at?: string | null;
          search_text?: never;
          services?: string[];
          siding_type?: string | null;
          speed_to_lead_seconds?: number | null;
          state?: string;
          status?: string;
          stories?: number | null;
          street?: string | null;
          temperature?: string | null;
          territory_id?: string | null;
          timeline?: string | null;
          unit?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          walkthrough_at?: string | null;
          year_built?: number | null;
          zip?: string | null;
        };
        Update: {
          account_id?: string | null;
          city?: string | null;
          company?: string | null;
          contact_id?: string | null;
          converted_at?: string | null;
          converted_job_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_notes?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          disposition?: string | null;
          email?: string | null;
          first_contacted_at?: string | null;
          first_name?: string;
          grade?: string | null;
          has_hoa?: boolean | null;
          home_built?: string | null;
          id?: string;
          intake_channel?: string;
          landing_page?: string | null;
          last_activity_at?: string;
          last_name?: string | null;
          lead_set_by?: string | null;
          lead_source?: string;
          lead_sub_source?: string | null;
          lost_reason?: string | null;
          mobile?: string | null;
          nurture_until?: string | null;
          org_id?: string;
          out_of_area?: boolean;
          owner_id?: string | null;
          page_path?: string | null;
          phone?: string | null;
          phone_digits?: never;
          point_of_contact_id?: string | null;
          property_id?: string | null;
          property_type?: string | null;
          referral_code?: string | null;
          referrer?: string | null;
          score?: number | null;
          score_factors?: NonNullable<Json>;
          scored_at?: string | null;
          search_text?: never;
          services?: string[];
          siding_type?: string | null;
          speed_to_lead_seconds?: number | null;
          state?: string;
          status?: string;
          stories?: number | null;
          street?: string | null;
          temperature?: string | null;
          territory_id?: string | null;
          timeline?: string | null;
          unit?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          walkthrough_at?: string | null;
          year_built?: number | null;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "leads_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_converted_job_fk";
            columns: ["converted_job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_lead_set_by_fkey";
            columns: ["lead_set_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_point_of_contact_id_fkey";
            columns: ["point_of_contact_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_territory_id_fkey";
            columns: ["territory_id"];
            isOneToOne: false;
            referencedRelation: "territories";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string | null;
          call_duration_seconds: number | null;
          call_outcome: string | null;
          channel: string;
          contact_id: string | null;
          created_at: string;
          direction: string;
          email_subject: string | null;
          from_address: string | null;
          id: string;
          org_id: string;
          outbox_id: string | null;
          sent_by: string | null;
          simulated: boolean;
          status: string;
          subject_id: string;
          subject_type: string;
          to_address: string | null;
        };
        ComputedFields: never;
        Insert: {
          body?: string | null;
          call_duration_seconds?: number | null;
          call_outcome?: string | null;
          channel: string;
          contact_id?: string | null;
          created_at?: string;
          direction: string;
          email_subject?: string | null;
          from_address?: string | null;
          id?: string;
          org_id: string;
          outbox_id?: string | null;
          sent_by?: string | null;
          simulated?: boolean;
          status: string;
          subject_id: string;
          subject_type: string;
          to_address?: string | null;
        };
        Update: {
          body?: string | null;
          call_duration_seconds?: number | null;
          call_outcome?: string | null;
          channel?: string;
          contact_id?: string | null;
          created_at?: string;
          direction?: string;
          email_subject?: string | null;
          from_address?: string | null;
          id?: string;
          org_id?: string;
          outbox_id?: string | null;
          sent_by?: string | null;
          simulated?: boolean;
          status?: string;
          subject_id?: string;
          subject_type?: string;
          to_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_outbox_id_fkey";
            columns: ["outbox_id"];
            isOneToOne: false;
            referencedRelation: "integration_outbox";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sent_by_fkey";
            columns: ["sent_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          body: string;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          id: string;
          org_id: string;
          pinned: boolean;
          priority: string;
          subject_id: string;
          subject_type: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          org_id: string;
          pinned?: boolean;
          priority?: string;
          subject_id: string;
          subject_type: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          id?: string;
          org_id?: string;
          pinned?: boolean;
          priority?: string;
          subject_id?: string;
          subject_type?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notes_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          link: string | null;
          org_id: string;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          link?: string | null;
          org_id: string;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          link?: string | null;
          org_id?: string;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pack_permissions: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          pack_id: string;
          permission: string;
          scope: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          pack_id: string;
          permission: string;
          scope?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          pack_id?: string;
          permission?: string;
          scope?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pack_permissions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pack_permissions_pack_id_fkey";
            columns: ["pack_id"];
            isOneToOne: false;
            referencedRelation: "permission_packs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pack_permissions_permission_fkey";
            columns: ["permission"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
        ];
      };
      permission_packs: {
        Row: {
          category: string;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string | null;
          id: string;
          is_system: boolean;
          key: string;
          name: string;
          org_id: string;
          sort_order: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          key: string;
          name: string;
          org_id: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          category?: string;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          key?: string;
          name?: string;
          org_id?: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "permission_packs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      permissions: {
        Row: {
          action: string;
          category: string;
          description: string | null;
          key: string;
          label: string;
          resource: string;
          sort_order: number;
          supports_scope: boolean;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          category: string;
          description?: string | null;
          key: string;
          label: string;
          resource: string;
          sort_order?: number;
          supports_scope?: boolean;
        };
        Update: {
          action?: string;
          category?: string;
          description?: string | null;
          key?: string;
          label?: string;
          resource?: string;
          sort_order?: number;
          supports_scope?: boolean;
        };
        Relationships: [];
      };
      picklist_values: {
        Row: {
          active: boolean;
          category: string | null;
          color: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          is_system: boolean;
          label: string;
          org_id: string;
          parent_value_id: string | null;
          picklist_id: string;
          sort_order: number;
          updated_at: string;
          updated_by: string | null;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          category?: string | null;
          color?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_system?: boolean;
          label: string;
          org_id: string;
          parent_value_id?: string | null;
          picklist_id: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          value: string;
        };
        Update: {
          active?: boolean;
          category?: string | null;
          color?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_system?: boolean;
          label?: string;
          org_id?: string;
          parent_value_id?: string | null;
          picklist_id?: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "picklist_values_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "picklist_values_parent_value_id_fkey";
            columns: ["parent_value_id"];
            isOneToOne: false;
            referencedRelation: "picklist_values";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "picklist_values_picklist_id_fkey";
            columns: ["picklist_id"];
            isOneToOne: false;
            referencedRelation: "picklists";
            referencedColumns: ["id"];
          },
        ];
      };
      picklists: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_system: boolean;
          key: string;
          module: string;
          name: string;
          org_id: string;
          parent_picklist_id: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          key: string;
          module: string;
          name: string;
          org_id: string;
          parent_picklist_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_system?: boolean;
          key?: string;
          module?: string;
          name?: string;
          org_id?: string;
          parent_picklist_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "picklists_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "picklists_parent_picklist_id_fkey";
            columns: ["parent_picklist_id"];
            isOneToOne: false;
            referencedRelation: "picklists";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_compensation: {
        Row: {
          created_at: string;
          created_by: string | null;
          hourly_cost_cents: number | null;
          id: string;
          org_id: string;
          profile_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          hourly_cost_cents?: number | null;
          id?: string;
          org_id: string;
          profile_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          hourly_cost_cents?: number | null;
          id?: string;
          org_id?: string;
          profile_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profile_compensation_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_compensation_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          calendar_color: string | null;
          created_at: string;
          created_by: string | null;
          deactivated_at: string | null;
          deactivated_by: string | null;
          default_territory_id: string | null;
          department: string | null;
          email: string;
          full_name: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          is_active: boolean;
          org_id: string;
          phone: string | null;
          preferences: NonNullable<Json>;
          role_template_id: string;
          signature: string | null;
          title: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          avatar_path?: string | null;
          calendar_color?: string | null;
          created_at?: string;
          created_by?: string | null;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          default_territory_id?: string | null;
          department?: string | null;
          email: string;
          full_name: string;
          id: string;
          invited_at?: string | null;
          invited_by?: string | null;
          is_active?: boolean;
          org_id: string;
          phone?: string | null;
          preferences?: NonNullable<Json>;
          role_template_id: string;
          signature?: string | null;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          avatar_path?: string | null;
          calendar_color?: string | null;
          created_at?: string;
          created_by?: string | null;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          default_territory_id?: string | null;
          department?: string | null;
          email?: string;
          full_name?: string;
          id?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          is_active?: boolean;
          org_id?: string;
          phone?: string | null;
          preferences?: NonNullable<Json>;
          role_template_id?: string;
          signature?: string | null;
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_default_territory_id_fkey";
            columns: ["default_territory_id"];
            isOneToOne: false;
            referencedRelation: "territories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_role_template_id_fkey";
            columns: ["role_template_id"];
            isOneToOne: false;
            referencedRelation: "role_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      properties: {
        Row: {
          access_notes: string | null;
          account_id: string;
          alarm: string | null;
          approx_sqft: number | null;
          city: string | null;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          has_hoa: boolean;
          hoa_color_approval_required: boolean;
          hoa_contact: string | null;
          hoa_name: string | null;
          home_built: string | null;
          id: string;
          is_primary: boolean;
          lat: number | null;
          lead_safe_required: boolean | null;
          lng: number | null;
          occupancy: string | null;
          org_id: string;
          out_of_area: boolean;
          parking: string | null;
          pets: string | null;
          property_type: string | null;
          search_text: string | null;
          siding_type: string | null;
          state: string;
          stories: number | null;
          street: string | null;
          territory_id: string | null;
          unit: string | null;
          updated_at: string;
          updated_by: string | null;
          water_power_access: string | null;
          year_built: number | null;
          zip: string | null;
        };
        ComputedFields: never;
        Insert: {
          access_notes?: string | null;
          account_id: string;
          alarm?: string | null;
          approx_sqft?: number | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          has_hoa?: boolean;
          hoa_color_approval_required?: boolean;
          hoa_contact?: string | null;
          hoa_name?: string | null;
          home_built?: string | null;
          id?: string;
          is_primary?: boolean;
          lat?: number | null;
          lead_safe_required?: never;
          lng?: number | null;
          occupancy?: string | null;
          org_id: string;
          out_of_area?: boolean;
          parking?: string | null;
          pets?: string | null;
          property_type?: string | null;
          search_text?: never;
          siding_type?: string | null;
          state?: string;
          stories?: number | null;
          street?: string | null;
          territory_id?: string | null;
          unit?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          water_power_access?: string | null;
          year_built?: number | null;
          zip?: string | null;
        };
        Update: {
          access_notes?: string | null;
          account_id?: string;
          alarm?: string | null;
          approx_sqft?: number | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          has_hoa?: boolean;
          hoa_color_approval_required?: boolean;
          hoa_contact?: string | null;
          hoa_name?: string | null;
          home_built?: string | null;
          id?: string;
          is_primary?: boolean;
          lat?: number | null;
          lead_safe_required?: never;
          lng?: number | null;
          occupancy?: string | null;
          org_id?: string;
          out_of_area?: boolean;
          parking?: string | null;
          pets?: string | null;
          property_type?: string | null;
          search_text?: never;
          siding_type?: string | null;
          state?: string;
          stories?: number | null;
          street?: string | null;
          territory_id?: string | null;
          unit?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          water_power_access?: string | null;
          year_built?: number | null;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "properties_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "properties_territory_id_fkey";
            columns: ["territory_id"];
            isOneToOne: false;
            referencedRelation: "territories";
            referencedColumns: ["id"];
          },
        ];
      };
      property_secrets: {
        Row: {
          access_code_ciphertext: string;
          created_at: string;
          created_by: string | null;
          org_id: string;
          property_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          access_code_ciphertext: string;
          created_at?: string;
          created_by?: string | null;
          org_id: string;
          property_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          access_code_ciphertext?: string;
          created_at?: string;
          created_by?: string | null;
          org_id?: string;
          property_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "property_secrets_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "property_secrets_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: true;
            referencedRelation: "properties";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          bucket: string;
          hits: number;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          bucket: string;
          hits?: number;
          window_start: string;
        };
        Update: {
          bucket?: string;
          hits?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      role_templates: {
        Row: {
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string | null;
          grants_all: boolean;
          id: string;
          is_crew: boolean;
          is_system: boolean;
          key: string;
          name: string;
          org_id: string;
          requires_mfa: boolean;
          sort_order: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          grants_all?: boolean;
          id?: string;
          is_crew?: boolean;
          is_system?: boolean;
          key: string;
          name: string;
          org_id: string;
          requires_mfa?: boolean;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          grants_all?: boolean;
          id?: string;
          is_crew?: boolean;
          is_system?: boolean;
          key?: string;
          name?: string;
          org_id?: string;
          requires_mfa?: boolean;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "role_templates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_views: {
        Row: {
          config: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          id: string;
          module: string;
          name: string;
          org_id: string;
          shared: boolean;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          config?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          module: string;
          name: string;
          org_id: string;
          shared?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
        };
        Update: {
          config?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          module?: string;
          name?: string;
          org_id?: string;
          shared?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_views_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_views_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stage_history: {
        Row: {
          approval_request_id: string | null;
          changed_at: string;
          changed_by: string | null;
          from_stage: string | null;
          gate: NonNullable<Json>;
          id: string;
          impersonated_by: string | null;
          job_id: string;
          org_id: string;
          override: boolean;
          reason: string | null;
          seq: number;
          to_stage: string;
        };
        ComputedFields: never;
        Insert: {
          approval_request_id?: string | null;
          changed_at?: string;
          changed_by?: string | null;
          from_stage?: string | null;
          gate?: NonNullable<Json>;
          id?: string;
          impersonated_by?: string | null;
          job_id: string;
          org_id: string;
          override?: boolean;
          reason?: string | null;
          seq?: never;
          to_stage: string;
        };
        Update: {
          approval_request_id?: string | null;
          changed_at?: string;
          changed_by?: string | null;
          from_stage?: string | null;
          gate?: NonNullable<Json>;
          id?: string;
          impersonated_by?: string | null;
          job_id?: string;
          org_id?: string;
          override?: boolean;
          reason?: string | null;
          seq?: never;
          to_stage?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stage_history_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stage_history_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assignee_id: string;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string | null;
          created_by_workflow: string | null;
          deleted_at: string | null;
          description: string | null;
          due_at: string | null;
          id: string;
          org_id: string;
          priority: string;
          status: string;
          subject_id: string | null;
          subject_type: string | null;
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          assignee_id: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_workflow?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          due_at?: string | null;
          id?: string;
          org_id: string;
          priority?: string;
          status?: string;
          subject_id?: string | null;
          subject_type?: string | null;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          assignee_id?: string;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_workflow?: string | null;
          deleted_at?: string | null;
          description?: string | null;
          due_at?: string | null;
          id?: string;
          org_id?: string;
          priority?: string;
          status?: string;
          subject_id?: string | null;
          subject_type?: string | null;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      template_packs: {
        Row: {
          created_at: string;
          id: string;
          org_id: string;
          pack_id: string;
          template_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          org_id: string;
          pack_id: string;
          template_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          org_id?: string;
          pack_id?: string;
          template_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "template_packs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "template_packs_pack_id_fkey";
            columns: ["pack_id"];
            isOneToOne: false;
            referencedRelation: "permission_packs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "template_packs_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "role_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      territories: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          id: string;
          is_service_area: boolean;
          name: string;
          org_id: string;
          sort_order: number;
          updated_at: string;
          updated_by: string | null;
          zip_codes: string[];
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          id?: string;
          is_service_area?: boolean;
          name: string;
          org_id: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          zip_codes?: string[];
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          id?: string;
          is_service_area?: boolean;
          name?: string;
          org_id?: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          zip_codes?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "territories_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_permission_overrides: {
        Row: {
          created_at: string;
          created_by: string | null;
          effect: string;
          id: string;
          org_id: string;
          permission: string;
          reason: string;
          scope: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          effect: string;
          id?: string;
          org_id: string;
          permission: string;
          reason: string;
          scope?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          effect?: string;
          id?: string;
          org_id?: string;
          permission?: string;
          reason?: string;
          scope?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_permission_overrides_permission_fkey";
            columns: ["permission"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "user_permission_overrides_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_job_stage_change: {
        Args: {
          p_approval_request?: string;
          p_from: string;
          p_gate?: Json;
          p_job: string;
          p_lost_reason?: string;
          p_override?: boolean;
          p_reason?: string;
          p_to: string;
        };
        Returns: string;
      };
      attention_summary: { Args: Record<PropertyKey, never>; Returns: Json };
      claim_events: {
        Args: { p_limit?: number; p_lock_seconds?: number };
        Returns: {
          actor_id: string | null;
          aggregate_id: string | null;
          aggregate_type: string;
          attempts: number;
          available_at: string;
          created_at: string;
          id: number;
          idempotency_key: string | null;
          impersonated_by: string | null;
          last_error: string | null;
          locked_at: string | null;
          org_id: string | null;
          payload: NonNullable<Json>;
          processed_at: string | null;
          status: string;
          type: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "events";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      consume_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      convert_lead_to_job: { Args: { p_lead: string; p_work_types?: string[] }; Returns: string };
      integration_summary: { Args: Record<PropertyKey, never>; Returns: Json };
      job_stats: { Args: { p_from: string; p_prev_from: string; p_to: string }; Returns: Json };
      job_status_counts: { Args: Record<PropertyKey, never>; Returns: Json };
      lead_stats: { Args: { p_now?: string }; Returns: Json };
      lead_status_counts: { Args: Record<PropertyKey, never>; Returns: Json };
      list_deleted_records: {
        Args: Record<PropertyKey, never>;
        Returns: {
          delete_reason: string;
          deleted_at: string;
          deleted_by: string;
          deleted_by_name: string;
          label: string;
          record_id: string;
          table_name: string;
        }[];
      };
      my_access: { Args: Record<PropertyKey, never>; Returns: Json };
      open_work_counts: { Args: { p_user_id: string }; Returns: Json };
      reorder_picklist_values: {
        Args: { p_picklist_id: string; p_value_ids: string[] };
        Returns: undefined;
      };
      restore_record: { Args: { p_id: string; p_table: string }; Returns: undefined };
      search_records: {
        Args: { p_limit?: number; p_query: string; p_scope?: string };
        Returns: {
          href: string;
          id: string;
          kind: string;
          rank: number;
          subtitle: string;
          title: string;
        }[];
      };
      soft_delete_record: {
        Args: { p_id: string; p_reason: string; p_table: string };
        Returns: undefined;
      };
      start_view_as: { Args: { p_target_user_id: string }; Returns: string };
      stop_view_as: { Args: Record<PropertyKey, never>; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
