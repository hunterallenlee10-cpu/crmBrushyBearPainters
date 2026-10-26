import { INTEGRATIONS, type IntegrationKey } from "@/lib/integrations/registry";

/**
 * Shared adapter core (SPEC §2.1: build ready, connect NOTHING).
 *
 * Every integration domain has a TypeScript interface, a default provider that
 * records what *would* have been sent to `integration_outbox` (status
 * `simulated`), and disabled stubs for real providers. This file holds the
 * pieces all domains share: the outbox entry shape, the sink interface, result
 * shapes and the provider-choice gate.
 */

/** A CRM record an outbox entry relates to (e.g. `{ type: "job", id }`). */
export type RelatedRecord = { type: string; id: string };

export type OutboxEntry = {
  orgId: string;
  domain: IntegrationKey;
  provider: string;
  operation: string;
  recipient?: string | null;
  subject?: string | null;
  renderedBody?: string | null;
  payload: Record<string, unknown>;
  related?: RelatedRecord | null;
  createdBy?: string | null;
};

/** Where outbox providers write. Production: `createSupabaseOutboxSink` (server-only). */
export interface OutboxSink {
  record(entry: OutboxEntry): Promise<{ id: string }>;
}

export type MemoryOutboxSink = OutboxSink & {
  readonly entries: (OutboxEntry & { id: string })[];
};

/** In-memory sink for tests and previews. Ids are deterministic (`outbox-1`, `outbox-2`, …). */
export function createMemoryOutboxSink(): MemoryOutboxSink {
  const entries: (OutboxEntry & { id: string })[] = [];
  return {
    entries,
    async record(entry) {
      const id = `outbox-${entries.length + 1}`;
      entries.push({ ...entry, id });
      return { id };
    },
  };
}

/** Result of a read-style operation while the domain is disconnected. */
export type NotConnected = { connected: false; reason: string };

export type SendStatus = "simulated" | "queued" | "sent" | "failed";

export type SendResult = {
  status: SendStatus;
  outboxId?: string;
  providerMessageId?: string;
  error?: string;
};

export type IntegrationContext = {
  orgId: string;
  actorId?: string | null;
  sink: OutboxSink;
};

/**
 * Hard lock on real providers. This build NEVER calls a real external API
 * (SPEC §2.1 "connect NOTHING"; CLAUDE.md working rule 3). A real provider can
 * only be used when ALL of these hold:
 *   (a) the env flag selects the real provider (e.g. INTEGRATION_SMS_PROVIDER=twilio),
 *   (b) the org's `integration_connections` row for the domain has status `connected`,
 *   (c) this constant is `false` — a deliberate, reviewed code change by the owners later.
 * The database adds a fourth guard: `app.integration_connections_guard` refuses
 * to mark any connection `connected` in this build.
 */
export const REAL_PROVIDERS_LOCKED = true;

export type ConnectionStatus = "not_connected" | "connected" | "error" | "disabled";

export type ProviderChoice = { provider: string; real: boolean; reason: string };

export type ResolveProviderChoiceInput = {
  /** Value of the domain's env flag (undefined/empty = not set). */
  envProvider?: string | null;
  /** The domain's disconnected provider (`outbox`, `builtin` or `disabled`). */
  defaultProvider: string;
  /** `integration_connections.status` for this org + domain (null = no row). */
  connectionStatus?: string | null;
  /** Defaults to `REAL_PROVIDERS_LOCKED`. Tests pass `false` to exercise the real path. */
  locked?: boolean;
  /** Real providers known for the domain. When given, anything else falls back to the default. */
  knownProviders?: readonly string[];
};

/**
 * Pure gate deciding which provider a domain uses. Anything short of all three
 * conditions (env flag + connected row + unlocked code) returns the default provider.
 */
export function resolveProviderChoice(input: ResolveProviderChoiceInput): ProviderChoice {
  const { defaultProvider, knownProviders } = input;
  const envProvider = input.envProvider?.trim() ?? "";
  const locked = input.locked ?? REAL_PROVIDERS_LOCKED;
  const fallback = (reason: string): ProviderChoice => ({
    provider: defaultProvider,
    real: false,
    reason,
  });

  if (envProvider === "" || envProvider === defaultProvider) {
    return fallback(`Env flag selects the default provider (${defaultProvider}).`);
  }
  if (knownProviders && !knownProviders.includes(envProvider)) {
    return fallback(`Unknown provider "${envProvider}"; using ${defaultProvider}.`);
  }
  if (locked) {
    return fallback(
      `Real providers are locked in this build (SPEC §2.1); "${envProvider}" is not used.`,
    );
  }
  if (input.connectionStatus !== "connected") {
    const status = input.connectionStatus ?? "missing";
    return fallback(`Connection status is "${status}", not "connected"; using ${defaultProvider}.`);
  }
  return {
    provider: envProvider,
    real: true,
    reason: `Env flag, connected row and unlocked build all allow ${envProvider}.`,
  };
}

/** Options every `get<Domain>Provider` factory accepts. */
export type ProviderFactoryOptions<Credentials> = {
  /** Pass `serverEnv().INTEGRATION_<DOMAIN>_PROVIDER`. */
  envProvider?: string | null;
  /** Pass the org's `integration_connections.status` for the domain. */
  connectionStatus?: string | null;
  /** Override for tests only. Defaults to `REAL_PROVIDERS_LOCKED`. */
  locked?: boolean;
  /** Injected HTTP client for real providers. Required when a real provider is chosen. */
  fetch?: typeof fetch;
  /** Per-provider credentials/config, keyed by provider id. */
  credentials?: Credentials;
};

export function integrationDefinition(domain: IntegrationKey) {
  const def = INTEGRATIONS.find((i) => i.key === domain);
  if (!def) throw new Error(`Unknown integration domain: ${domain}`);
  return def;
}

/** `resolveProviderChoice` with the domain's default and known providers filled in from the registry. */
export function resolveDomainProvider(
  domain: IntegrationKey,
  options: Pick<ProviderFactoryOptions<unknown>, "envProvider" | "connectionStatus" | "locked">,
): ProviderChoice {
  const def = integrationDefinition(domain);
  return resolveProviderChoice({
    envProvider: options.envProvider,
    defaultProvider: def.defaultProvider,
    connectionStatus: options.connectionStatus,
    locked: options.locked,
    knownProviders: def.realProviders,
  });
}

/** Programmer/config error: a real provider was allowed but its fetch or credentials are missing. */
export function requireRealDeps<C>(
  provider: string,
  fetchFn: typeof fetch | undefined,
  config: C | undefined,
): { fetch: typeof fetch; config: C } {
  if (!fetchFn) throw new Error(`Provider "${provider}" needs an injected fetch.`);
  if (config === undefined)
    throw new Error(`Provider "${provider}" has no credentials configured.`);
  return { fetch: fetchFn, config };
}

/** Write one simulated outbox entry for a send-style operation. */
export async function recordSimulated(
  ctx: IntegrationContext,
  entry: Omit<OutboxEntry, "orgId" | "createdBy">,
): Promise<{ status: "simulated"; outboxId: string }> {
  const { id } = await ctx.sink.record({
    ...entry,
    orgId: ctx.orgId,
    createdBy: ctx.actorId ?? null,
  });
  return { status: "simulated", outboxId: id };
}

export function notConnected(reason: string): NotConnected {
  return { connected: false, reason };
}

/** Throws for non-integer cents (money is integer cents everywhere — CLAUDE.md). */
export function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be an integer number of cents, got ${value}.`);
  }
}

/** Integer cents → decimal dollars for provider APIs that want decimals (e.g. 123456 → 1234.56). */
export function centsToDecimal(cents: number): number {
  assertCents(cents, "amount");
  return Math.round(cents) / 100;
}

/** Display helper for rendered outbox bodies, e.g. 123456 → "$1,234.56". */
export function formatUsd(cents: number): string {
  assertCents(cents, "amount");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars}.${rest}`;
}
