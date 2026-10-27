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
      agreement_templates: {
        Row: {
          approval_note: string | null;
          approved_at: string | null;
          approved_by: string | null;
          body: string;
          clauses: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          doc_type: string;
          id: string;
          is_default: boolean;
          name: string;
          org_id: string;
          required_fields: string[];
          signer_roles: string[];
          status: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          approval_note?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          body: string;
          clauses?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          doc_type: string;
          id?: string;
          is_default?: boolean;
          name: string;
          org_id: string;
          required_fields?: string[];
          signer_roles?: string[];
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          approval_note?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          body?: string;
          clauses?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          doc_type?: string;
          id?: string;
          is_default?: boolean;
          name?: string;
          org_id?: string;
          required_fields?: string[];
          signer_roles?: string[];
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agreement_templates_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agreement_templates_org_id_fkey";
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
      catalog_items: {
        Row: {
          active: boolean;
          allowance_note: string | null;
          code: string;
          created_at: string;
          created_by: string | null;
          customer_description: string | null;
          default_coats: number;
          default_method: string;
          default_product_id: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          family: string;
          id: string;
          is_optional_default: boolean;
          is_repair_allowance: boolean;
          is_sample: boolean;
          item_type: string;
          labor_hours_per_unit: number;
          name: string;
          org_id: string;
          paint_sqft_per_unit: number;
          price_book_id: string;
          pricing_method: string;
          sort_order: number;
          surface: string | null;
          taxable: boolean;
          unit: string;
          unit_cost_cents: number | null;
          unit_price_cents: number | null;
          updated_at: string;
          updated_by: string | null;
          work_order_phase: string | null;
          work_type: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          allowance_note?: string | null;
          code: string;
          created_at?: string;
          created_by?: string | null;
          customer_description?: string | null;
          default_coats?: number;
          default_method?: string;
          default_product_id?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          family: string;
          id?: string;
          is_optional_default?: boolean;
          is_repair_allowance?: boolean;
          is_sample?: boolean;
          item_type: string;
          labor_hours_per_unit?: number;
          name: string;
          org_id: string;
          paint_sqft_per_unit?: number;
          price_book_id: string;
          pricing_method?: string;
          sort_order?: number;
          surface?: string | null;
          taxable?: boolean;
          unit: string;
          unit_cost_cents?: number | null;
          unit_price_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          work_order_phase?: string | null;
          work_type?: string | null;
        };
        Update: {
          active?: boolean;
          allowance_note?: string | null;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          customer_description?: string | null;
          default_coats?: number;
          default_method?: string;
          default_product_id?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          family?: string;
          id?: string;
          is_optional_default?: boolean;
          is_repair_allowance?: boolean;
          is_sample?: boolean;
          item_type?: string;
          labor_hours_per_unit?: number;
          name?: string;
          org_id?: string;
          paint_sqft_per_unit?: number;
          price_book_id?: string;
          pricing_method?: string;
          sort_order?: number;
          surface?: string | null;
          taxable?: boolean;
          unit?: string;
          unit_cost_cents?: number | null;
          unit_price_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          work_order_phase?: string | null;
          work_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_items_default_product_id_fkey";
            columns: ["default_product_id"];
            isOneToOne: false;
            referencedRelation: "paint_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "catalog_items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "catalog_items_price_book_id_fkey";
            columns: ["price_book_id"];
            isOneToOne: false;
            referencedRelation: "price_books";
            referencedColumns: ["id"];
          },
        ];
      };
      change_orders: {
        Row: {
          bill_separately: boolean;
          change_order_number: string;
          created_at: string;
          created_by: string | null;
          created_from_field: boolean;
          decline_reason: string | null;
          declined_at: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          estimate_id: string | null;
          expires_at: string | null;
          field_notes: string | null;
          id: string;
          job_id: string;
          org_id: string;
          priced: NonNullable<Json>;
          priced_at: string | null;
          proposal: Json | null;
          reason: string | null;
          sent_at: string | null;
          sent_by: string | null;
          settings_snapshot: NonNullable<Json>;
          signed_at: string | null;
          status: string;
          subtotal_cents: number | null;
          tax_cents: number | null;
          title: string;
          total_cents: number | null;
          updated_at: string;
          updated_by: string | null;
          viewed_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          bill_separately?: boolean;
          change_order_number: string;
          created_at?: string;
          created_by?: string | null;
          created_from_field?: boolean;
          decline_reason?: string | null;
          declined_at?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_id?: string | null;
          expires_at?: string | null;
          field_notes?: string | null;
          id?: string;
          job_id: string;
          org_id: string;
          priced?: NonNullable<Json>;
          priced_at?: string | null;
          proposal?: Json | null;
          reason?: string | null;
          sent_at?: string | null;
          sent_by?: string | null;
          settings_snapshot?: NonNullable<Json>;
          signed_at?: string | null;
          status?: string;
          subtotal_cents?: number | null;
          tax_cents?: number | null;
          title: string;
          total_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          viewed_at?: string | null;
        };
        Update: {
          bill_separately?: boolean;
          change_order_number?: string;
          created_at?: string;
          created_by?: string | null;
          created_from_field?: boolean;
          decline_reason?: string | null;
          declined_at?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_id?: string | null;
          expires_at?: string | null;
          field_notes?: string | null;
          id?: string;
          job_id?: string;
          org_id?: string;
          priced?: NonNullable<Json>;
          priced_at?: string | null;
          proposal?: Json | null;
          reason?: string | null;
          sent_at?: string | null;
          sent_by?: string | null;
          settings_snapshot?: NonNullable<Json>;
          signed_at?: string | null;
          status?: string;
          subtotal_cents?: number | null;
          tax_cents?: number | null;
          title?: string;
          total_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          viewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "change_orders_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "change_orders_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "change_orders_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      color_selections: {
        Row: {
          area: string;
          brand: string | null;
          change_order_id: string | null;
          color_code: string | null;
          color_name: string | null;
          created_at: string;
          created_by: string | null;
          customer_confirmed_at: string | null;
          deleted_at: string | null;
          estimate_version_id: string | null;
          finish_notes: string | null;
          id: string;
          job_id: string;
          line_item_id: string | null;
          org_id: string;
          paint_product_id: string | null;
          sheen: string | null;
          sort_order: number;
          status: string;
          surface: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          area: string;
          brand?: string | null;
          change_order_id?: string | null;
          color_code?: string | null;
          color_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_confirmed_at?: string | null;
          deleted_at?: string | null;
          estimate_version_id?: string | null;
          finish_notes?: string | null;
          id?: string;
          job_id: string;
          line_item_id?: string | null;
          org_id: string;
          paint_product_id?: string | null;
          sheen?: string | null;
          sort_order?: number;
          status?: string;
          surface: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          area?: string;
          brand?: string | null;
          change_order_id?: string | null;
          color_code?: string | null;
          color_name?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_confirmed_at?: string | null;
          deleted_at?: string | null;
          estimate_version_id?: string | null;
          finish_notes?: string | null;
          id?: string;
          job_id?: string;
          line_item_id?: string | null;
          org_id?: string;
          paint_product_id?: string | null;
          sheen?: string | null;
          sort_order?: number;
          status?: string;
          surface?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "color_selections_change_order_id_fkey";
            columns: ["change_order_id"];
            isOneToOne: false;
            referencedRelation: "change_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "color_selections_estimate_version_id_fkey";
            columns: ["estimate_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "color_selections_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "color_selections_line_item_id_fkey";
            columns: ["line_item_id"];
            isOneToOne: false;
            referencedRelation: "estimate_line_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "color_selections_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "color_selections_paint_product_id_fkey";
            columns: ["paint_product_id"];
            isOneToOne: false;
            referencedRelation: "paint_products";
            referencedColumns: ["id"];
          },
        ];
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
      documents: {
        Row: {
          account_id: string | null;
          category: string;
          created_at: string;
          created_by: string | null;
          customer_visible: boolean;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          file_name: string;
          id: string;
          job_id: string | null;
          mime_type: string;
          notes: string | null;
          org_id: string;
          related_id: string | null;
          related_type: string | null;
          sha256: string | null;
          signature_id: string | null;
          size_bytes: number;
          source: string;
          status: string;
          storage_bucket: string;
          storage_path: string;
          title: string;
          updated_at: string;
          updated_by: string | null;
          uploaded_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          category: string;
          created_at?: string;
          created_by?: string | null;
          customer_visible?: boolean;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          file_name: string;
          id?: string;
          job_id?: string | null;
          mime_type: string;
          notes?: string | null;
          org_id: string;
          related_id?: string | null;
          related_type?: string | null;
          sha256?: string | null;
          signature_id?: string | null;
          size_bytes: number;
          source?: string;
          status?: string;
          storage_bucket?: string;
          storage_path: string;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
          uploaded_by?: string | null;
        };
        Update: {
          account_id?: string | null;
          category?: string;
          created_at?: string;
          created_by?: string | null;
          customer_visible?: boolean;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          file_name?: string;
          id?: string;
          job_id?: string | null;
          mime_type?: string;
          notes?: string | null;
          org_id?: string;
          related_id?: string | null;
          related_type?: string | null;
          sha256?: string | null;
          signature_id?: string | null;
          size_bytes?: number;
          source?: string;
          status?: string;
          storage_bucket?: string;
          storage_path?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "documents_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_signature_id_fkey";
            columns: ["signature_id"];
            isOneToOne: false;
            referencedRelation: "signatures";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_areas: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          measurements: NonNullable<Json>;
          name: string;
          notes: string | null;
          option_id: string;
          org_id: string;
          sort_order: number;
          updated_at: string;
          updated_by: string | null;
          version_id: string;
          work_type: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          measurements?: NonNullable<Json>;
          name: string;
          notes?: string | null;
          option_id: string;
          org_id: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          version_id: string;
          work_type?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          measurements?: NonNullable<Json>;
          name?: string;
          notes?: string | null;
          option_id?: string;
          org_id?: string;
          sort_order?: number;
          updated_at?: string;
          updated_by?: string | null;
          version_id?: string;
          work_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_areas_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "estimate_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_areas_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_areas_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_line_items: {
        Row: {
          access: string;
          area_id: string | null;
          catalog_code: string | null;
          catalog_item_id: string | null;
          change_order_id: string | null;
          coats: number;
          color_change: string;
          computed_price_cents: number | null;
          condition: string;
          containers: Json | null;
          cost_cents: number | null;
          created_at: string;
          created_by: string | null;
          customer_note: string | null;
          gallons: number | null;
          gallons_needed: number | null;
          height: string;
          id: string;
          is_credit: boolean;
          is_optional: boolean;
          is_repair_allowance: boolean;
          issues: NonNullable<Json>;
          kind: string;
          labor_cost_cents: number | null;
          labor_hours: number | null;
          labor_hours_per_unit: number | null;
          lead_safe: boolean;
          material_cost_cents: number | null;
          measurement: NonNullable<Json>;
          method: string;
          name: string;
          option_id: string | null;
          org_id: string;
          override_price_cents: number | null;
          override_reason: string | null;
          paint_product_id: string | null;
          paint_sqft_per_unit: number | null;
          prep_hours: number | null;
          prep_level: string;
          price_cents: number | null;
          priced_snapshot: Json | null;
          primer: string;
          primer_gallons: number | null;
          primer_gallons_needed: number | null;
          primer_product_id: string | null;
          quantity: number;
          sheen: string | null;
          sides: number;
          sort_order: number;
          sundries_cents: number | null;
          surface: string | null;
          taxable: boolean;
          unit: string;
          unit_cost_cents: number | null;
          unit_price_cents: number | null;
          updated_at: string;
          updated_by: string | null;
          version_id: string | null;
          work_order_phase: string | null;
          work_type: string | null;
        };
        ComputedFields: never;
        Insert: {
          access?: string;
          area_id?: string | null;
          catalog_code?: string | null;
          catalog_item_id?: string | null;
          change_order_id?: string | null;
          coats?: number;
          color_change?: string;
          computed_price_cents?: number | null;
          condition?: string;
          containers?: Json | null;
          cost_cents?: number | null;
          created_at?: string;
          created_by?: string | null;
          customer_note?: string | null;
          gallons?: number | null;
          gallons_needed?: number | null;
          height?: string;
          id?: string;
          is_credit?: boolean;
          is_optional?: boolean;
          is_repair_allowance?: boolean;
          issues?: NonNullable<Json>;
          kind: string;
          labor_cost_cents?: number | null;
          labor_hours?: number | null;
          labor_hours_per_unit?: number | null;
          lead_safe?: boolean;
          material_cost_cents?: number | null;
          measurement?: NonNullable<Json>;
          method?: string;
          name: string;
          option_id?: string | null;
          org_id: string;
          override_price_cents?: number | null;
          override_reason?: string | null;
          paint_product_id?: string | null;
          paint_sqft_per_unit?: number | null;
          prep_hours?: number | null;
          prep_level?: string;
          price_cents?: number | null;
          priced_snapshot?: Json | null;
          primer?: string;
          primer_gallons?: number | null;
          primer_gallons_needed?: number | null;
          primer_product_id?: string | null;
          quantity?: number;
          sheen?: string | null;
          sides?: number;
          sort_order?: number;
          sundries_cents?: number | null;
          surface?: string | null;
          taxable?: boolean;
          unit: string;
          unit_cost_cents?: number | null;
          unit_price_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          version_id?: string | null;
          work_order_phase?: string | null;
          work_type?: string | null;
        };
        Update: {
          access?: string;
          area_id?: string | null;
          catalog_code?: string | null;
          catalog_item_id?: string | null;
          change_order_id?: string | null;
          coats?: number;
          color_change?: string;
          computed_price_cents?: number | null;
          condition?: string;
          containers?: Json | null;
          cost_cents?: number | null;
          created_at?: string;
          created_by?: string | null;
          customer_note?: string | null;
          gallons?: number | null;
          gallons_needed?: number | null;
          height?: string;
          id?: string;
          is_credit?: boolean;
          is_optional?: boolean;
          is_repair_allowance?: boolean;
          issues?: NonNullable<Json>;
          kind?: string;
          labor_cost_cents?: number | null;
          labor_hours?: number | null;
          labor_hours_per_unit?: number | null;
          lead_safe?: boolean;
          material_cost_cents?: number | null;
          measurement?: NonNullable<Json>;
          method?: string;
          name?: string;
          option_id?: string | null;
          org_id?: string;
          override_price_cents?: number | null;
          override_reason?: string | null;
          paint_product_id?: string | null;
          paint_sqft_per_unit?: number | null;
          prep_hours?: number | null;
          prep_level?: string;
          price_cents?: number | null;
          priced_snapshot?: Json | null;
          primer?: string;
          primer_gallons?: number | null;
          primer_gallons_needed?: number | null;
          primer_product_id?: string | null;
          quantity?: number;
          sheen?: string | null;
          sides?: number;
          sort_order?: number;
          sundries_cents?: number | null;
          surface?: string | null;
          taxable?: boolean;
          unit?: string;
          unit_cost_cents?: number | null;
          unit_price_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          version_id?: string | null;
          work_order_phase?: string | null;
          work_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_line_items_area_id_fkey";
            columns: ["area_id"];
            isOneToOne: false;
            referencedRelation: "estimate_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_line_items_catalog_item_id_fkey";
            columns: ["catalog_item_id"];
            isOneToOne: false;
            referencedRelation: "catalog_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_line_items_change_order_id_fkey";
            columns: ["change_order_id"];
            isOneToOne: false;
            referencedRelation: "change_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_line_items_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "estimate_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_line_items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_line_items_paint_product_id_fkey";
            columns: ["paint_product_id"];
            isOneToOne: false;
            referencedRelation: "paint_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_line_items_primer_product_id_fkey";
            columns: ["primer_product_id"];
            isOneToOne: false;
            referencedRelation: "paint_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_line_items_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_options: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          is_recommended: boolean;
          name: string;
          org_id: string;
          sort_order: number;
          subtotal_cents: number | null;
          total_cents: number | null;
          updated_at: string;
          updated_by: string | null;
          version_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_recommended?: boolean;
          name: string;
          org_id: string;
          sort_order?: number;
          subtotal_cents?: number | null;
          total_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          version_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          is_recommended?: boolean;
          name?: string;
          org_id?: string;
          sort_order?: number;
          subtotal_cents?: number | null;
          total_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_options_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_options_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_settings: {
        Row: {
          calibrated_at: string | null;
          calibrated_by: string | null;
          created_at: string;
          created_by: string | null;
          discount_limits: NonNullable<Json>;
          guarantees: NonNullable<Json>;
          guarantees_status: string;
          id: string;
          is_sample: boolean;
          lead_safe_disclosure: string | null;
          org_id: string;
          pricing: NonNullable<Json>;
          updated_at: string;
          updated_by: string | null;
          whats_included: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          calibrated_at?: string | null;
          calibrated_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          discount_limits?: NonNullable<Json>;
          guarantees?: NonNullable<Json>;
          guarantees_status?: string;
          id?: string;
          is_sample?: boolean;
          lead_safe_disclosure?: string | null;
          org_id: string;
          pricing?: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
          whats_included?: NonNullable<Json>;
        };
        Update: {
          calibrated_at?: string | null;
          calibrated_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          discount_limits?: NonNullable<Json>;
          guarantees?: NonNullable<Json>;
          guarantees_status?: string;
          id?: string;
          is_sample?: boolean;
          lead_safe_disclosure?: string | null;
          org_id?: string;
          pricing?: NonNullable<Json>;
          updated_at?: string;
          updated_by?: string | null;
          whats_included?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_settings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      estimate_versions: {
        Row: {
          accepted_addon_ids: string[];
          accepted_at: string | null;
          accepted_option_id: string | null;
          accepted_totals: Json | null;
          created_at: string;
          created_by: string | null;
          customer_notes: string | null;
          decline_reason: string | null;
          declined_at: string | null;
          deposit_percent: number | null;
          discount_approved_at: string | null;
          discount_approved_by: string | null;
          discount_approved_percent: number | null;
          discount_reason: string | null;
          discount_type: string | null;
          discount_value: number | null;
          estimate_id: string;
          expires_at: string | null;
          id: string;
          internal_notes: string | null;
          max_effective_discount_percent: number;
          org_id: string;
          priced: NonNullable<Json>;
          priced_at: string | null;
          proposal: Json | null;
          sent_at: string | null;
          sent_by: string | null;
          sent_channels: string[];
          settings_snapshot: NonNullable<Json>;
          status: string;
          updated_at: string;
          updated_by: string | null;
          version_no: number;
          view_count: number;
          viewed_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          accepted_addon_ids?: string[];
          accepted_at?: string | null;
          accepted_option_id?: string | null;
          accepted_totals?: Json | null;
          created_at?: string;
          created_by?: string | null;
          customer_notes?: string | null;
          decline_reason?: string | null;
          declined_at?: string | null;
          deposit_percent?: number | null;
          discount_approved_at?: string | null;
          discount_approved_by?: string | null;
          discount_approved_percent?: number | null;
          discount_reason?: string | null;
          discount_type?: string | null;
          discount_value?: number | null;
          estimate_id: string;
          expires_at?: string | null;
          id?: string;
          internal_notes?: string | null;
          max_effective_discount_percent?: number;
          org_id: string;
          priced?: NonNullable<Json>;
          priced_at?: string | null;
          proposal?: Json | null;
          sent_at?: string | null;
          sent_by?: string | null;
          sent_channels?: string[];
          settings_snapshot?: NonNullable<Json>;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version_no: number;
          view_count?: number;
          viewed_at?: string | null;
        };
        Update: {
          accepted_addon_ids?: string[];
          accepted_at?: string | null;
          accepted_option_id?: string | null;
          accepted_totals?: Json | null;
          created_at?: string;
          created_by?: string | null;
          customer_notes?: string | null;
          decline_reason?: string | null;
          declined_at?: string | null;
          deposit_percent?: number | null;
          discount_approved_at?: string | null;
          discount_approved_by?: string | null;
          discount_approved_percent?: number | null;
          discount_reason?: string | null;
          discount_type?: string | null;
          discount_value?: number | null;
          estimate_id?: string;
          expires_at?: string | null;
          id?: string;
          internal_notes?: string | null;
          max_effective_discount_percent?: number;
          org_id?: string;
          priced?: NonNullable<Json>;
          priced_at?: string | null;
          proposal?: Json | null;
          sent_at?: string | null;
          sent_by?: string | null;
          sent_channels?: string[];
          settings_snapshot?: NonNullable<Json>;
          status?: string;
          updated_at?: string;
          updated_by?: string | null;
          version_no?: number;
          view_count?: number;
          viewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimate_versions_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimate_versions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      estimates: {
        Row: {
          accepted_at: string | null;
          accepted_option_id: string | null;
          accepted_version_id: string | null;
          created_at: string;
          created_by: string | null;
          current_version_id: string | null;
          decline_reason: string | null;
          declined_at: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          estimate_number: string;
          expires_at: string | null;
          id: string;
          job_id: string;
          org_id: string;
          owner_id: string | null;
          sent_at: string | null;
          status: string;
          title: string | null;
          total_cents: number | null;
          updated_at: string;
          updated_by: string | null;
          viewed_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          accepted_option_id?: string | null;
          accepted_version_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          decline_reason?: string | null;
          declined_at?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_number: string;
          expires_at?: string | null;
          id?: string;
          job_id: string;
          org_id: string;
          owner_id?: string | null;
          sent_at?: string | null;
          status?: string;
          title?: string | null;
          total_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          viewed_at?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          accepted_option_id?: string | null;
          accepted_version_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          decline_reason?: string | null;
          declined_at?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_number?: string;
          expires_at?: string | null;
          id?: string;
          job_id?: string;
          org_id?: string;
          owner_id?: string | null;
          sent_at?: string | null;
          status?: string;
          title?: string | null;
          total_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          viewed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "estimates_accepted_version_fk";
            columns: ["accepted_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "estimates_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
      invoice_lines: {
        Row: {
          amount_cents: number;
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          invoice_id: string;
          org_id: string;
          quantity: number;
          sort_order: number;
          source_id: string | null;
          source_type: string | null;
          tax_cents: number;
          taxable: boolean;
          unit_price_cents: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount_cents?: number;
          created_at?: string;
          created_by?: string | null;
          description: string;
          id?: string;
          invoice_id: string;
          org_id: string;
          quantity?: number;
          sort_order?: number;
          source_id?: string | null;
          source_type?: string | null;
          tax_cents?: number;
          taxable?: boolean;
          unit_price_cents: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          invoice_id?: string;
          org_id?: string;
          quantity?: number;
          sort_order?: number;
          source_id?: string | null;
          source_type?: string | null;
          tax_cents?: number;
          taxable?: boolean;
          unit_price_cents?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_lines_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      invoices: {
        Row: {
          account_id: string | null;
          accounting_error: string | null;
          accounting_sync_status: string;
          change_order_id: string | null;
          created_at: string;
          created_by: string | null;
          due_date: string | null;
          estimate_id: string | null;
          estimate_version_id: string | null;
          external_id: string | null;
          external_synced_at: string | null;
          id: string;
          invoice_number: string;
          invoice_type: string;
          issue_date: string | null;
          job_id: string;
          notes: string | null;
          org_id: string;
          sent_at: string | null;
          status: string;
          subtotal_cents: number;
          tax_cents: number;
          terms: string | null;
          total_cents: number;
          updated_at: string;
          updated_by: string | null;
          viewed_at: string | null;
          void_reason: string | null;
          voided_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          account_id?: string | null;
          accounting_error?: string | null;
          accounting_sync_status?: string;
          change_order_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_date?: string | null;
          estimate_id?: string | null;
          estimate_version_id?: string | null;
          external_id?: string | null;
          external_synced_at?: string | null;
          id?: string;
          invoice_number: string;
          invoice_type: string;
          issue_date?: string | null;
          job_id: string;
          notes?: string | null;
          org_id: string;
          sent_at?: string | null;
          status?: string;
          subtotal_cents?: number;
          tax_cents?: number;
          terms?: string | null;
          total_cents?: number;
          updated_at?: string;
          updated_by?: string | null;
          viewed_at?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Update: {
          account_id?: string | null;
          accounting_error?: string | null;
          accounting_sync_status?: string;
          change_order_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          due_date?: string | null;
          estimate_id?: string | null;
          estimate_version_id?: string | null;
          external_id?: string | null;
          external_synced_at?: string | null;
          id?: string;
          invoice_number?: string;
          invoice_type?: string;
          issue_date?: string | null;
          job_id?: string;
          notes?: string | null;
          org_id?: string;
          sent_at?: string | null;
          status?: string;
          subtotal_cents?: number;
          tax_cents?: number;
          terms?: string | null;
          total_cents?: number;
          updated_at?: string;
          updated_by?: string | null;
          viewed_at?: string | null;
          void_reason?: string | null;
          voided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_change_order_id_fkey";
            columns: ["change_order_id"];
            isOneToOne: false;
            referencedRelation: "change_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_estimate_version_id_fkey";
            columns: ["estimate_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      job_financials: {
        Row: {
          change_orders_cents: number;
          contract_baseline_cents: number | null;
          contract_cents: number | null;
          created_at: string;
          created_by: string | null;
          estimate_contract_cents: number | null;
          job_id: string;
          org_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          change_orders_cents?: number;
          contract_baseline_cents?: number | null;
          contract_cents?: never;
          created_at?: string;
          created_by?: string | null;
          estimate_contract_cents?: number | null;
          job_id: string;
          org_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          change_orders_cents?: number;
          contract_baseline_cents?: number | null;
          contract_cents?: never;
          created_at?: string;
          created_by?: string | null;
          estimate_contract_cents?: number | null;
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
      job_photos: {
        Row: {
          area: string | null;
          caption: string | null;
          category: string;
          checklist_key: string | null;
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          customer_visible: boolean;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          exif_stripped: boolean;
          height: number | null;
          id: string;
          job_id: string;
          mime_type: string;
          org_id: string;
          sha256: string | null;
          shared_at: string | null;
          size_bytes: number;
          source: string;
          storage_path: string;
          taken_at: string | null;
          thumb_path: string;
          thumb_size_bytes: number;
          updated_at: string;
          updated_by: string | null;
          uploaded_by: string | null;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          area?: string | null;
          caption?: string | null;
          category?: string;
          checklist_key?: string | null;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_visible?: boolean;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          exif_stripped?: boolean;
          height?: number | null;
          id?: string;
          job_id: string;
          mime_type: string;
          org_id: string;
          sha256?: string | null;
          shared_at?: string | null;
          size_bytes: number;
          source?: string;
          storage_path: string;
          taken_at?: string | null;
          thumb_path: string;
          thumb_size_bytes?: number;
          updated_at?: string;
          updated_by?: string | null;
          uploaded_by?: string | null;
          width?: number | null;
        };
        Update: {
          area?: string | null;
          caption?: string | null;
          category?: string;
          checklist_key?: string | null;
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_visible?: boolean;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          exif_stripped?: boolean;
          height?: number | null;
          id?: string;
          job_id?: string;
          mime_type?: string;
          org_id?: string;
          sha256?: string | null;
          shared_at?: string | null;
          size_bytes?: number;
          source?: string;
          storage_path?: string;
          taken_at?: string | null;
          thumb_path?: string;
          thumb_size_bytes?: number;
          updated_at?: string;
          updated_by?: string | null;
          uploaded_by?: string | null;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_photos_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_photos_org_id_fkey";
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
            foreignKeyName: "jobs_accepted_estimate_fk";
            columns: ["accepted_estimate_id"];
            isOneToOne: false;
            referencedRelation: "estimates";
            referencedColumns: ["id"];
          },
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
          template_key: string | null;
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
          template_key?: string | null;
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
          template_key?: string | null;
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
      onboarding_requirements: {
        Row: {
          auto_detail: string | null;
          auto_status: string | null;
          auto_verify_rule: string | null;
          created_at: string;
          created_by: string | null;
          group_key: string;
          id: string;
          job_id: string;
          key: string;
          label: string;
          last_checked_at: string | null;
          note: string | null;
          org_id: string;
          owner_role: string | null;
          requested_at: string | null;
          requested_by: string | null;
          required: boolean;
          sort_order: number;
          source_estimate_version_id: string | null;
          status: string;
          task_id: string | null;
          updated_at: string;
          updated_by: string | null;
          verified_at: string | null;
          verified_auto: boolean;
          verified_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          auto_detail?: string | null;
          auto_status?: string | null;
          auto_verify_rule?: string | null;
          created_at?: string;
          created_by?: string | null;
          group_key: string;
          id?: string;
          job_id: string;
          key: string;
          label: string;
          last_checked_at?: string | null;
          note?: string | null;
          org_id: string;
          owner_role?: string | null;
          requested_at?: string | null;
          requested_by?: string | null;
          required?: boolean;
          sort_order?: number;
          source_estimate_version_id?: string | null;
          status?: string;
          task_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verified_at?: string | null;
          verified_auto?: boolean;
          verified_by?: string | null;
        };
        Update: {
          auto_detail?: string | null;
          auto_status?: string | null;
          auto_verify_rule?: string | null;
          created_at?: string;
          created_by?: string | null;
          group_key?: string;
          id?: string;
          job_id?: string;
          key?: string;
          label?: string;
          last_checked_at?: string | null;
          note?: string | null;
          org_id?: string;
          owner_role?: string | null;
          requested_at?: string | null;
          requested_by?: string | null;
          required?: boolean;
          sort_order?: number;
          source_estimate_version_id?: string | null;
          status?: string;
          task_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verified_at?: string | null;
          verified_auto?: boolean;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "onboarding_requirements_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "onboarding_requirements_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "onboarding_requirements_source_estimate_version_id_fkey";
            columns: ["source_estimate_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "onboarding_requirements_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
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
      paint_order_lines: {
        Row: {
          color_code: string | null;
          color_name: string | null;
          containers: Json | null;
          cost_cents: number;
          created_at: string;
          created_by: string | null;
          gallons: number;
          gallons_needed: number;
          id: string;
          is_primer: boolean;
          is_sundries: boolean;
          label: string;
          org_id: string;
          paint_order_id: string;
          paint_product_id: string | null;
          received_gallons: number;
          sheen: string | null;
          sort_order: number;
          unit_cost_cents: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          color_code?: string | null;
          color_name?: string | null;
          containers?: Json | null;
          cost_cents?: number;
          created_at?: string;
          created_by?: string | null;
          gallons?: number;
          gallons_needed?: number;
          id?: string;
          is_primer?: boolean;
          is_sundries?: boolean;
          label: string;
          org_id: string;
          paint_order_id: string;
          paint_product_id?: string | null;
          received_gallons?: number;
          sheen?: string | null;
          sort_order?: number;
          unit_cost_cents?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          color_code?: string | null;
          color_name?: string | null;
          containers?: Json | null;
          cost_cents?: number;
          created_at?: string;
          created_by?: string | null;
          gallons?: number;
          gallons_needed?: number;
          id?: string;
          is_primer?: boolean;
          is_sundries?: boolean;
          label?: string;
          org_id?: string;
          paint_order_id?: string;
          paint_product_id?: string | null;
          received_gallons?: number;
          sheen?: string | null;
          sort_order?: number;
          unit_cost_cents?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "paint_order_lines_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paint_order_lines_paint_order_id_fkey";
            columns: ["paint_order_id"];
            isOneToOne: false;
            referencedRelation: "paint_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paint_order_lines_paint_product_id_fkey";
            columns: ["paint_product_id"];
            isOneToOne: false;
            referencedRelation: "paint_products";
            referencedColumns: ["id"];
          },
        ];
      };
      paint_orders: {
        Row: {
          change_order_id: string | null;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          estimate_version_id: string | null;
          expected_on: string | null;
          external_ref: string | null;
          fulfillment: string | null;
          id: string;
          job_id: string;
          notes: string | null;
          ordered_at: string | null;
          org_id: string;
          po_number: string;
          received_at: string | null;
          status: string;
          supplier: string | null;
          total_cost_cents: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          change_order_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_version_id?: string | null;
          expected_on?: string | null;
          external_ref?: string | null;
          fulfillment?: string | null;
          id?: string;
          job_id: string;
          notes?: string | null;
          ordered_at?: string | null;
          org_id: string;
          po_number: string;
          received_at?: string | null;
          status?: string;
          supplier?: string | null;
          total_cost_cents?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          change_order_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_version_id?: string | null;
          expected_on?: string | null;
          external_ref?: string | null;
          fulfillment?: string | null;
          id?: string;
          job_id?: string;
          notes?: string | null;
          ordered_at?: string | null;
          org_id?: string;
          po_number?: string;
          received_at?: string | null;
          status?: string;
          supplier?: string | null;
          total_cost_cents?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "paint_orders_change_order_id_fkey";
            columns: ["change_order_id"];
            isOneToOne: false;
            referencedRelation: "change_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paint_orders_estimate_version_id_fkey";
            columns: ["estimate_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paint_orders_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paint_orders_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      paint_products: {
        Row: {
          active: boolean;
          base: string | null;
          brand: string;
          containers: string[];
          cost_per_gal_cents: number;
          coverage_sqft_per_gal: number;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          dry_time_hours: number | null;
          id: string;
          is_primer: boolean;
          is_sample: boolean;
          line: string | null;
          min_temp_f: number | null;
          notes: string | null;
          org_id: string;
          price_per_gal_cents: number | null;
          product: string;
          recoat_hours: number | null;
          sheens: string[];
          updated_at: string;
          updated_by: string | null;
          use: string;
          voc_g_per_l: number | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          base?: string | null;
          brand: string;
          containers?: string[];
          cost_per_gal_cents: number;
          coverage_sqft_per_gal: number;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          dry_time_hours?: number | null;
          id?: string;
          is_primer?: boolean;
          is_sample?: boolean;
          line?: string | null;
          min_temp_f?: number | null;
          notes?: string | null;
          org_id: string;
          price_per_gal_cents?: number | null;
          product: string;
          recoat_hours?: number | null;
          sheens?: string[];
          updated_at?: string;
          updated_by?: string | null;
          use?: string;
          voc_g_per_l?: number | null;
        };
        Update: {
          active?: boolean;
          base?: string | null;
          brand?: string;
          containers?: string[];
          cost_per_gal_cents?: number;
          coverage_sqft_per_gal?: number;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          dry_time_hours?: number | null;
          id?: string;
          is_primer?: boolean;
          is_sample?: boolean;
          line?: string | null;
          min_temp_f?: number | null;
          notes?: string | null;
          org_id?: string;
          price_per_gal_cents?: number | null;
          product?: string;
          recoat_hours?: number | null;
          sheens?: string[];
          updated_at?: string;
          updated_by?: string | null;
          use?: string;
          voc_g_per_l?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "paint_products_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
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
      price_books: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string | null;
          effective_from: string | null;
          effective_to: string | null;
          id: string;
          is_default: boolean;
          name: string;
          org_id: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          is_default?: boolean;
          name: string;
          org_id: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string | null;
          effective_from?: string | null;
          effective_to?: string | null;
          id?: string;
          is_default?: boolean;
          name?: string;
          org_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "price_books_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      production_rates: {
        Row: {
          active: boolean;
          condition: string;
          created_at: string;
          created_by: string | null;
          id: string;
          is_sample: boolean;
          method: string;
          notes: string | null;
          org_id: string;
          prep_hours_per_unit: number;
          surface: string;
          units_per_labor_hour: number;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          condition: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_sample?: boolean;
          method: string;
          notes?: string | null;
          org_id: string;
          prep_hours_per_unit?: number;
          surface: string;
          units_per_labor_hour: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          active?: boolean;
          condition?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_sample?: boolean;
          method?: string;
          notes?: string | null;
          org_id?: string;
          prep_hours_per_unit?: number;
          surface?: string;
          units_per_labor_hour?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "production_rates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
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
      proposal_tokens: {
        Row: {
          change_order_id: string | null;
          created_at: string;
          created_by: string | null;
          estimate_version_id: string | null;
          expires_at: string;
          first_viewed_at: string | null;
          id: string;
          job_id: string;
          last_viewed_at: string | null;
          org_id: string;
          revoked_at: string | null;
          revoked_reason: string | null;
          token_hash: string;
          used_at: string | null;
          view_count: number;
        };
        ComputedFields: never;
        Insert: {
          change_order_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimate_version_id?: string | null;
          expires_at: string;
          first_viewed_at?: string | null;
          id?: string;
          job_id: string;
          last_viewed_at?: string | null;
          org_id: string;
          revoked_at?: string | null;
          revoked_reason?: string | null;
          token_hash: string;
          used_at?: string | null;
          view_count?: number;
        };
        Update: {
          change_order_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          estimate_version_id?: string | null;
          expires_at?: string;
          first_viewed_at?: string | null;
          id?: string;
          job_id?: string;
          last_viewed_at?: string | null;
          org_id?: string;
          revoked_at?: string | null;
          revoked_reason?: string | null;
          token_hash?: string;
          used_at?: string | null;
          view_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "proposal_tokens_change_order_id_fkey";
            columns: ["change_order_id"];
            isOneToOne: false;
            referencedRelation: "change_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proposal_tokens_estimate_version_id_fkey";
            columns: ["estimate_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proposal_tokens_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proposal_tokens_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
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
      signatures: {
        Row: {
          change_order_id: string | null;
          consent_text: string;
          created_at: string;
          document_id: string | null;
          estimate_version_id: string | null;
          id: string;
          ip: unknown;
          job_id: string;
          org_id: string;
          selection: NonNullable<Json>;
          signature_png: string;
          signature_sha256: string;
          signed_at: string;
          signer_email: string | null;
          signer_name: string;
          token_id: string | null;
          user_agent: string | null;
        };
        ComputedFields: never;
        Insert: {
          change_order_id?: string | null;
          consent_text: string;
          created_at?: string;
          document_id?: string | null;
          estimate_version_id?: string | null;
          id?: string;
          ip?: unknown;
          job_id: string;
          org_id: string;
          selection?: NonNullable<Json>;
          signature_png: string;
          signature_sha256: string;
          signed_at?: string;
          signer_email?: string | null;
          signer_name: string;
          token_id?: string | null;
          user_agent?: string | null;
        };
        Update: {
          change_order_id?: string | null;
          consent_text?: string;
          created_at?: string;
          document_id?: string | null;
          estimate_version_id?: string | null;
          id?: string;
          ip?: unknown;
          job_id?: string;
          org_id?: string;
          selection?: NonNullable<Json>;
          signature_png?: string;
          signature_sha256?: string;
          signed_at?: string;
          signer_email?: string | null;
          signer_name?: string;
          token_id?: string | null;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "signatures_change_order_id_fkey";
            columns: ["change_order_id"];
            isOneToOne: false;
            referencedRelation: "change_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signatures_document_fk";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signatures_estimate_version_id_fkey";
            columns: ["estimate_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signatures_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signatures_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "signatures_token_id_fkey";
            columns: ["token_id"];
            isOneToOne: false;
            referencedRelation: "proposal_tokens";
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
      work_order_costs: {
        Row: {
          created_at: string;
          created_by: string | null;
          org_id: string;
          sub_po_cents: number | null;
          updated_at: string;
          updated_by: string | null;
          work_order_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          org_id: string;
          sub_po_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          work_order_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          org_id?: string;
          sub_po_cents?: number | null;
          updated_at?: string;
          updated_by?: string | null;
          work_order_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_costs_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_costs_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: true;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_orders: {
        Row: {
          actual_hours: number | null;
          assigned_user_ids: string[];
          budgeted_hours: number;
          change_order_id: string | null;
          checklist_instance_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          crew_id: string | null;
          delete_reason: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          estimate_version_id: string | null;
          id: string;
          job_id: string;
          notes: string | null;
          org_id: string;
          phase: string;
          priority: string;
          scheduled_end: string | null;
          scheduled_start: string | null;
          scope_summary: string | null;
          status: string;
          title: string;
          updated_at: string;
          updated_by: string | null;
          work_order_number: string;
        };
        ComputedFields: never;
        Insert: {
          actual_hours?: number | null;
          assigned_user_ids?: string[];
          budgeted_hours?: number;
          change_order_id?: string | null;
          checklist_instance_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          crew_id?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_version_id?: string | null;
          id?: string;
          job_id: string;
          notes?: string | null;
          org_id: string;
          phase: string;
          priority?: string;
          scheduled_end?: string | null;
          scheduled_start?: string | null;
          scope_summary?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
          work_order_number: string;
        };
        Update: {
          actual_hours?: number | null;
          assigned_user_ids?: string[];
          budgeted_hours?: number;
          change_order_id?: string | null;
          checklist_instance_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          crew_id?: string | null;
          delete_reason?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          estimate_version_id?: string | null;
          id?: string;
          job_id?: string;
          notes?: string | null;
          org_id?: string;
          phase?: string;
          priority?: string;
          scheduled_end?: string | null;
          scheduled_start?: string | null;
          scope_summary?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
          work_order_number?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_change_order_id_fkey";
            columns: ["change_order_id"];
            isOneToOne: false;
            referencedRelation: "change_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_estimate_version_id_fkey";
            columns: ["estimate_version_id"];
            isOneToOne: false;
            referencedRelation: "estimate_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_change_order: {
        Args: {
          p_consent: string;
          p_ip: unknown;
          p_outputs: Json;
          p_signature_png: string;
          p_signature_sha256: string;
          p_signer_email: string;
          p_signer_name: string;
          p_token_hash: string;
          p_user_agent: string;
        };
        Returns: Json;
      };
      accept_estimate: {
        Args: {
          p_addons: string[];
          p_consent: string;
          p_ip: unknown;
          p_option: string;
          p_outputs: Json;
          p_signature_png: string;
          p_signature_sha256: string;
          p_signer_email: string;
          p_signer_name: string;
          p_token_hash: string;
          p_totals: Json;
          p_user_agent: string;
        };
        Returns: Json;
      };
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
      apply_onboarding_checks: { Args: { p_job: string; p_results: Json }; Returns: Json };
      approve_version_discount: {
        Args: { p_by: string; p_percent: number; p_version: string };
        Returns: undefined;
      };
      attach_signed_document: {
        Args: { p_document: string; p_signature: string };
        Returns: undefined;
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
      copy_estimate_version: { Args: { p_version: string }; Returns: string };
      create_estimate: { Args: { p_job: string; p_title?: string }; Returns: string };
      decline_proposal: { Args: { p_reason: string; p_token_hash: string }; Returns: Json };
      document_stats: { Args: { p_job?: string }; Returns: Json };
      estimate_stats: { Args: { p_from: string; p_to: string }; Returns: Json };
      estimate_status_counts: { Args: Record<PropertyKey, never>; Returns: Json };
      expire_proposals: { Args: Record<PropertyKey, never>; Returns: number };
      integration_summary: { Args: Record<PropertyKey, never>; Returns: Json };
      job_photo_summary: { Args: { p_job: string }; Returns: Json };
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
      mark_change_order_sent: {
        Args: {
          p_change_order: string;
          p_channels: string[];
          p_expires_at: string;
          p_proposal: Json;
          p_token_hash: string;
        };
        Returns: string;
      };
      mark_estimate_sent: {
        Args: {
          p_channels: string[];
          p_expires_at: string;
          p_proposal: Json;
          p_token_hash: string;
          p_total_cents: number;
          p_version: string;
        };
        Returns: string;
      };
      my_access: { Args: Record<PropertyKey, never>; Returns: Json };
      open_work_counts: { Args: { p_user_id: string }; Returns: Json };
      record_proposal_view: { Args: { p_token_hash: string }; Returns: Json };
      reorder_picklist_values: {
        Args: { p_picklist_id: string; p_value_ids: string[] };
        Returns: undefined;
      };
      resolve_proposal_token: { Args: { p_token_hash: string }; Returns: Json };
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
      soft_delete_post: { Args: { p_id: string; p_table: string }; Returns: undefined };
      soft_delete_record: {
        Args: { p_id: string; p_reason: string; p_table: string };
        Returns: undefined;
      };
      start_view_as: { Args: { p_target_user_id: string }; Returns: string };
      stop_view_as: { Args: Record<PropertyKey, never>; Returns: undefined };
      store_change_order_pricing: {
        Args: {
          p_change_order: string;
          p_lines: Json;
          p_priced: Json;
          p_settings: Json;
          p_subtotal: number;
          p_tax: number;
          p_total: number;
        };
        Returns: undefined;
      };
      store_version_pricing: {
        Args: {
          p_lines: Json;
          p_max_discount: number;
          p_options: Json;
          p_priced: Json;
          p_settings: Json;
          p_version: string;
        };
        Returns: undefined;
      };
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
