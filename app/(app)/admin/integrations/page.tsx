import type { Metadata } from "next";
import {
  Calculator,
  CalendarDays,
  Camera,
  CloudSun,
  CreditCard,
  FileSignature,
  Inbox,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import {
  buildIntegrationCards,
  connectedSummary,
  supportsTestSend,
  type IntegrationCardModel,
} from "@/lib/admin/integration-format";
import {
  OUTBOX_LIST_LIMIT,
  isHtmlBody,
  maskContactsInText,
  maskRecipient,
  outboxStatusLabel,
  payloadJson,
} from "@/lib/admin/outbox-format";
import { formatPacific } from "@/lib/admin/pacific";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { INTEGRATIONS, type IntegrationKey } from "@/lib/integrations/registry";
import { ConfigureSheet, TestSendButton } from "./integration-actions-client";
import { OutboxList, type OutboxRowView } from "./outbox-list-client";

export const metadata: Metadata = { title: "Integrations" };

const ICONS: Record<IntegrationKey, LucideIcon> = {
  sms_voice: MessageSquare,
  email: Mail,
  calendar: CalendarDays,
  accounting: Calculator,
  payments: CreditCard,
  esign: FileSignature,
  geo: MapPin,
  weather: CloudSun,
  photos: Camera,
  reviews: Star,
  ai: Sparkles,
};

const DOMAIN_NAMES = new Map<string, string>(INTEGRATIONS.map((d) => [d.key, d.name]));

export default async function IntegrationsPage() {
  const viewer = await requirePermission("integrations:read");
  const supabase = await createSupabaseServerClient();

  const [{ data: connections }, { data: outbox }] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("domain, provider, status, last_sync_at, last_error")
      .eq("org_id", viewer.orgId),
    supabase
      .from("integration_outbox")
      .select(
        "id, created_at, domain, operation, recipient, subject, rendered_body, payload, status",
      )
      .eq("org_id", viewer.orgId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(OUTBOX_LIST_LIMIT),
  ]);

  const cards = buildIntegrationCards(connections ?? []);
  const summary = connectedSummary(cards);
  const canTest = viewer.can("integrations:manage") && !viewer.impersonating;

  const rows: OutboxRowView[] = (outbox ?? []).map((r) => ({
    id: r.id,
    when: formatPacific(r.created_at),
    domain: DOMAIN_NAMES.get(r.domain) ?? r.domain,
    operation: r.operation,
    recipient: maskRecipient(r.recipient),
    subject: r.subject,
    status: r.status,
    statusLabel: outboxStatusLabel(r.status),
    body: r.rendered_body
      ? {
          kind: isHtmlBody(r.rendered_body) ? "html" : "text",
          content: maskContactsInText(r.rendered_body),
        }
      : null,
    payloadJson: payloadJson(r.payload),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="Outside services the CRM is built to use. Each one stays off until the owners set it up."
        actions={
          <p
            className="rounded-full border bg-card px-3 py-1 text-sm font-semibold"
            data-testid="integrations-summary"
          >
            {summary.label}
          </p>
        }
      />

      <div className="flex items-start gap-3 rounded-2xl border border-bb-honey bg-bb-honey/15 p-4 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-semibold">This build connects nothing.</span> Anything that would be
          sent is recorded below as <span className="font-semibold">Simulated – not sent</span>.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Integrations">
        {cards.map((card) => (
          <li key={card.key} className="flex">
            <IntegrationCard card={card} canTest={canTest} />
          </li>
        ))}
      </ul>

      <section aria-labelledby="outbox-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="outbox-heading" className="text-lg font-semibold">
            Outbox
          </h2>
          <p className="text-sm text-muted-foreground">
            The {OUTBOX_LIST_LIMIT} most recent messages and calls the CRM would have made.
            Recipients are partly hidden.
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing simulated yet">
            Nothing has been simulated yet. Messages appear here once workflows start sending (Phase
            8).
          </EmptyState>
        ) : (
          <OutboxList rows={rows} />
        )}
      </section>
    </div>
  );
}

function IntegrationCard({ card, canTest }: { card: IntegrationCardModel; canTest: boolean }) {
  const Icon = ICONS[card.key];
  const headingId = `integration-${card.key}`;
  return (
    <article
      aria-labelledby={headingId}
      className="flex w-full flex-col gap-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-bb-forest">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={headingId} className="font-semibold">
              {card.name}
            </h2>
            <Badge variant={card.statusTone}>{card.statusLabel}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{card.purpose}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Provider in use</dt>
        <dd>{card.providerInUse}</dd>
        <dt className="text-muted-foreground">Can connect to</dt>
        <dd>{card.realProviders.join(", ")}</dd>
        <dt className="text-muted-foreground">Last sync</dt>
        <dd>{card.lastSyncAt ? formatPacific(card.lastSyncAt) : "Never"}</dd>
        <dt className="text-muted-foreground">Frequency</dt>
        <dd>{card.syncFrequency}</dd>
        {card.lastError && (
          <>
            <dt className="text-danger">Last error</dt>
            <dd className="text-danger">{card.lastError}</dd>
          </>
        )}
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <ConfigureSheet
          domainKey={card.key}
          name={card.name}
          purpose={card.purpose}
          providerInUse={card.providerInUse}
          realProviders={card.realProviders}
          setupSteps={card.setupSteps}
          envVars={card.envVars}
        />
        {canTest && supportsTestSend(card.key) && (
          <TestSendButton domain={card.key} name={card.name} />
        )}
      </div>
    </article>
  );
}
