import {
  INTEGRATIONS,
  type IntegrationDefinition,
  type IntegrationKey,
} from "@/lib/integrations/registry";

/**
 * Pure view-model for Admin → Integrations (SPEC §2.1): the registry joined with
 * each org's `integration_connections` row. Nothing here connects anything.
 */

export const CONNECT_LOCKED_REASON =
  "Connecting real providers is turned off in this build — see docs/INTEGRATIONS.md → How the lock works.";

/** Domains with a "Send a test (simulated)" action. */
export const TEST_SEND_DOMAINS = [
  "email",
  "sms_voice",
] as const satisfies readonly IntegrationKey[];
export type TestSendDomain = (typeof TEST_SEND_DOMAINS)[number];

export function supportsTestSend(key: string): key is TestSendDomain {
  return (TEST_SEND_DOMAINS as readonly string[]).includes(key);
}

/** Fake number for simulated test texts (555-01xx is reserved for fiction). */
export const TEST_SMS_NUMBER = "+15555550100";

const PROVIDER_LABELS: Record<string, string> = {
  outbox: "Outbox (simulated)",
  builtin: "Built-in (BearSign)",
  disabled: "Disabled",
  twilio: "Twilio",
  resend: "Resend",
  sendgrid: "SendGrid",
  google_calendar: "Google Calendar",
  quickbooks_online: "QuickBooks Online",
  stripe: "Stripe",
  docusign: "DocuSign",
  dropbox_sign: "Dropbox Sign",
  google_places: "Google Places",
  mapbox: "Mapbox",
  nws: "NOAA/NWS (api.weather.gov)",
  openweather: "OpenWeather",
  companycam: "CompanyCam",
  google_business_profile: "Google Business Profile",
  anthropic: "Anthropic",
};

export function providerLabel(provider: string): string {
  return (
    PROVIDER_LABELS[provider] ??
    provider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export type StatusTone = "neutral" | "success" | "danger" | "warning";

export function connectionStatusDisplay(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "connected":
      return { label: "Connected", tone: "success" };
    case "error":
      return { label: "Error", tone: "danger" };
    case "disabled":
      return { label: "Disabled", tone: "warning" };
    default:
      return { label: "Not connected", tone: "neutral" };
  }
}

const ENV_VAR_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/**
 * Env vars an owner sets for this domain: the provider flag(s) first, then
 * every credential named in the setup checklist (e.g. TWILIO_AUTH_TOKEN).
 */
export function envVarsFor(def: Pick<IntegrationDefinition, "envVars" | "setupSteps">): string[] {
  const out = new Set<string>(def.envVars);
  for (const step of def.setupSteps) {
    for (const m of step.matchAll(ENV_VAR_RE)) out.add(m[0]);
  }
  return [...out];
}

export type ConnectionRow = {
  domain: string;
  provider: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
};

export type IntegrationCardModel = {
  key: IntegrationKey;
  name: string;
  purpose: string;
  status: string;
  statusLabel: string;
  statusTone: StatusTone;
  providerInUse: string;
  realProviders: string[];
  syncFrequency: string;
  lastSyncAt: string | null;
  lastError: string | null;
  setupSteps: string[];
  envVars: string[];
  canTestSend: boolean;
};

/** One card per registry domain, in registry order. A missing row reads as Not connected. */
export function buildIntegrationCards(rows: readonly ConnectionRow[]): IntegrationCardModel[] {
  const byDomain = new Map(rows.map((r) => [r.domain, r]));
  return INTEGRATIONS.map((def) => {
    const row = byDomain.get(def.key);
    const status = row?.status ?? "not_connected";
    const display = connectionStatusDisplay(status);
    // While disconnected the default provider is what actually runs, whatever the row says.
    const providerInUse = status === "connected" && row ? row.provider : def.defaultProvider;
    return {
      key: def.key,
      name: def.name,
      purpose: def.purpose,
      status,
      statusLabel: display.label,
      statusTone: display.tone,
      providerInUse: providerLabel(providerInUse),
      realProviders: def.realProviders.map(providerLabel),
      syncFrequency: def.syncFrequency,
      lastSyncAt: row?.last_sync_at ?? null,
      lastError: row?.last_error ?? null,
      setupSteps: [...def.setupSteps],
      envVars: envVarsFor(def),
      canTestSend: supportsTestSend(def.key),
    };
  });
}

export function connectedSummary(cards: readonly Pick<IntegrationCardModel, "status">[]): {
  connected: number;
  total: number;
  label: string;
} {
  const connected = cards.filter((c) => c.status === "connected").length;
  return { connected, total: cards.length, label: `${connected} of ${cards.length} connected` };
}
