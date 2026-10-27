"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/public-env";
import type { Database } from "@/lib/db/types";
import { SESSION_COOKIE_OPTIONS } from "@/lib/db/cookie-options";

/** Supabase client for Client Components (anon key + user session; RLS applies). */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey, { cookieOptions: SESSION_COOKIE_OPTIONS });
}
