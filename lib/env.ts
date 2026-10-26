import { z } from "zod";

/**
 * Environment handling. Everything is optional in Phase 0 so the shell builds
 * with an empty environment; code that needs a value calls the matching
 * `require*` helper, which fails with a clear message.
 *
 * Never read secrets in client components. Only NEXT_PUBLIC_* values reach the browser.
 */

const provider = <const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).default(fallback);

const boolString = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),

  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  CRON_SECRET: z.string().min(16).optional(),
  LEAD_INTAKE_HMAC_SECRET: z.string().min(32).optional(),
  LEAD_INTAKE_ORG_SLUG: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("brushy-bear"),
  /** 32 random bytes, base64. Encrypts gate/lockbox codes (app-level AES-256-GCM). */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "Must be 32 bytes, base64-encoded.",
    })
    .optional(),
  SEED_OWNER_EMAILS: z.string().optional(),
  DEMO_DATA: boolString,

  // Integrations (SPEC §2.1): every domain defaults to its disconnected provider.
  INTEGRATION_SMS_PROVIDER: provider(["outbox", "twilio"], "outbox"),
  INTEGRATION_VOICE_PROVIDER: provider(["outbox", "twilio"], "outbox"),
  INTEGRATION_EMAIL_PROVIDER: provider(["outbox", "resend", "sendgrid"], "outbox"),
  INTEGRATION_CALENDAR_PROVIDER: provider(["outbox", "google_calendar"], "outbox"),
  INTEGRATION_ACCOUNTING_PROVIDER: provider(["outbox", "quickbooks_online"], "outbox"),
  INTEGRATION_PAYMENTS_PROVIDER: provider(["outbox", "stripe"], "outbox"),
  INTEGRATION_ESIGN_PROVIDER: provider(["builtin", "docusign", "dropbox_sign"], "builtin"),
  INTEGRATION_GEO_PROVIDER: provider(["outbox", "google_places", "mapbox"], "outbox"),
  INTEGRATION_WEATHER_PROVIDER: provider(["outbox", "nws", "openweather"], "outbox"),
  INTEGRATION_PHOTOS_PROVIDER: provider(["outbox", "companycam"], "outbox"),
  INTEGRATION_REVIEWS_PROVIDER: provider(["outbox", "google_business_profile"], "outbox"),
  INTEGRATION_AI_PROVIDER: provider(["disabled", "anthropic"], "disabled"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Treat empty strings as unset (common in .env files and CI). */
function clean(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(clean(source));
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Server-side environment (validated once per process). */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

// Browser-safe helpers live in lib/public-env.ts; re-exported here for server code.
export { isSupabaseConfigured, requireSupabaseEnv, type SupabaseEnv } from "@/lib/public-env";
