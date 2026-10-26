export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
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
      integration_summary: { Args: Record<PropertyKey, never>; Returns: Json };
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
