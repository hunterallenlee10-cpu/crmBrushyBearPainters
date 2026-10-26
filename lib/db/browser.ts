"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/db/types";

/** Supabase client for Client Components (anon key + user session; RLS applies). */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
