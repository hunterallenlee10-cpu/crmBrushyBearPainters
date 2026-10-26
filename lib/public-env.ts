/**
 * Browser-safe settings: only NEXT_PUBLIC_* values. Client code imports this
 * module, never `lib/env.ts` (which describes server secrets).
 */

export type SupabaseEnv = { url: string; anonKey: string };

/**
 * Public Supabase settings. Referenced as literal `process.env.NEXT_PUBLIC_*`
 * so Next.js can inline them into the browser bundle.
 */
export function requireSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "(run `pnpm supabase start` and copy the values it prints into .env.local).",
    );
  }
  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
