import type { Metadata } from "next";
import Link from "next/link";
import { BellOff, Mail, MessageSquare, Phone, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  CONTACTS_LIST as BASE_CONTACTS_LIST,
  CONTACT_ACCOUNT_OWNER_COLUMN,
} from "@/lib/lists/modules/contacts";
import { customCells } from "@/components/custom-fields/list-cells";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { withCustomFields } from "@/lib/domain/custom-fields";

import { filterToOps } from "@/lib/lists/filters";
import { listOps, parseListState, resolveColumns } from "@/lib/lists/params";
import { applyOps, loadColumnPrefs, loadSavedViews } from "@/lib/lists/server";
import { formatDate, formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import {
  CONTACT_ROLE_LABELS,
  PREFERRED_CHANNEL_LABELS,
  isContactRole,
  isPreferredChannel,
} from "@/lib/validation/accounts";
import { ConsentBadges, PrimaryBadge } from "../accounts/_components/badges";
import { ContactsListClient } from "./contacts-list-client";

export const metadata: Metadata = { title: "Contacts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// `!inner` lets "Mine" filter on the account owner; see CONTACT_ACCOUNT_OWNER_COLUMN.
const SELECT =
  "id, first_name, last_name, role, mobile, phone, email, preferred_channel, sms_opt_in, email_opt_in, opted_out_at, do_not_contact, created_at, account_id, custom_field_values, account:accounts!contacts_account_id_fkey!inner(display_name, owner_id, primary_contact_id)";

function percent(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export default async function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("contacts:read");
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const customDefs = await loadCustomFields(supabase, "contacts");
  const CONTACTS_LIST = withCustomFields(BASE_CONTACTS_LIST, customDefs);
  const state = parseListState(await searchParams, CONTACTS_LIST);

  // KPI and tab counts: head-only count queries over every visible contact (RLS).
  function head() {
    return supabase.from("contacts").select("id", { count: "exact", head: true });
  }
  const n = (q: PromiseLike<{ count: number | null }>) =>
    Promise.resolve(q).then((r) => r.count ?? 0);

  const [savedViews, columnPrefs, counts] = await Promise.all([
    loadSavedViews(supabase, "contacts", viewer.real.id),
    loadColumnPrefs(supabase, viewer.real.id, "contacts"),
    Promise.all([
      n(head()),
      n(head().or("mobile.not.is.null,phone.not.is.null")),
      n(head().not("email", "is", null)),
      n(head().eq("sms_opt_in", true)),
      n(head().eq("do_not_contact", true)),
      n(
        supabase
          .from("contacts")
          .select("id, account:accounts!contacts_account_id_fkey!inner(owner_id)", {
            count: "exact",
            head: true,
          })
          .eq(CONTACT_ACCOUNT_OWNER_COLUMN, viewer.id),
      ),
    ]).then(([total, phone, email, sms, dnc, mine]) => ({ total, phone, email, sms, dnc, mine })),
  ]);

  const fields = CONTACTS_LIST.fields;
  const view = savedViews.find((v) => v.id === state.view);
  const visibleColumns = resolveColumns(CONTACTS_LIST, view?.config.columns ?? columnPrefs);
  const ops = listOps(
    state,
    CONTACTS_LIST,
    { userId: viewer.id, now },
    filterToOps(state.filter, fields, now),
  );

  const fromRow = (state.page - 1) * state.size;
  const {
    data: contacts,
    count: total,
    error,
  } = await applyOps(supabase.from("contacts").select(SELECT, { count: "exact" }), ops)
    .order(state.sort, { ascending: state.dir === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(fromRow, fromRow + state.size - 1);
  if (error) throw error;

  const rows = (contacts ?? []).map((c) => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
    const isPrimary = c.account.primary_contact_id === c.id;
    return {
      id: c.id,
      label: name,
      cells: {
        name: (
          <Link
            href={`/contacts/${c.id}`}
            className="font-medium whitespace-nowrap text-bb-forest hover:underline"
          >
            {name}
          </Link>
        ),
        account: (
          <div className="flex items-center gap-1.5">
            <Link
              href={`/accounts/${c.account_id}`}
              className="text-xs whitespace-nowrap hover:underline"
            >
              {c.account.display_name}
            </Link>
            {isPrimary && <PrimaryBadge />}
          </div>
        ),
        role: (
          <span className="text-xs whitespace-nowrap">
            {isContactRole(c.role) ? CONTACT_ROLE_LABELS[c.role] : c.role}
          </span>
        ),
        mobile: c.mobile ? (
          <span className="text-xs whitespace-nowrap tabular-nums">{formatPhone(c.mobile)}</span>
        ) : null,
        phone: c.phone ? (
          <span className="text-xs whitespace-nowrap tabular-nums">{formatPhone(c.phone)}</span>
        ) : null,
        email: c.email ? <span className="block max-w-56 truncate text-xs">{c.email}</span> : null,
        consent: (
          <ConsentBadges
            smsOptIn={c.sms_opt_in}
            emailOptIn={c.email_opt_in}
            doNotContact={c.do_not_contact}
            optedOut={c.opted_out_at !== null}
          />
        ),
        preferred_channel:
          c.preferred_channel && isPreferredChannel(c.preferred_channel) ? (
            <span className="text-xs">{PREFERRED_CHANNEL_LABELS[c.preferred_channel]}</span>
          ) : null,
        last_name: c.last_name ? <span className="text-xs">{c.last_name}</span> : null,
        created: (
          <span className="text-xs whitespace-nowrap" title={formatDate(c.created_at)}>
            {formatRelative(c.created_at, now)}
          </span>
        ),
        ...customCells(customDefs, c.custom_field_values),
      },
    };
  });

  const tabs = CONTACTS_LIST.tabs.map((t) => ({
    id: t.id,
    label: t.label,
    count: counts[t.countKey as keyof typeof counts] ?? null,
  }));
  const hasFilters = state.q !== "" || state.chips.length > 0 || state.filter.rules.length > 0;
  const fmt = (x: number) => x.toLocaleString("en-US");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Contacts"
        description="The people on each account and how we may reach them."
      />
      <section aria-label="Contact totals" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard
          label="Total contacts"
          value={fmt(counts.total)}
          caption="Every contact you can see"
          icon={Users}
          href="/contacts"
        />
        <KpiCard
          label="Reachable by phone"
          value={percent(counts.phone, counts.total)}
          caption={`${fmt(counts.phone)} of ${fmt(counts.total)} have a mobile or phone`}
          icon={Phone}
          tone="info"
        />
        <KpiCard
          label="Reachable by email"
          value={percent(counts.email, counts.total)}
          caption={`${fmt(counts.email)} of ${fmt(counts.total)} have an email`}
          icon={Mail}
          tone="info"
        />
        <KpiCard
          label="Opted in to texts"
          value={percent(counts.sms, counts.total)}
          caption={`${fmt(counts.sms)} of ${fmt(counts.total)} agreed to marketing texts`}
          icon={MessageSquare}
          tone="success"
          href="/contacts?tab=sms"
        />
        <KpiCard
          label="Do not contact"
          value={fmt(counts.dnc)}
          caption="Blocked from all marketing"
          icon={BellOff}
          tone="danger"
          href="/contacts?tab=dnc"
        />
      </section>
      <ContactsListClient
        state={state}
        defaults={{ defaultTab: CONTACTS_LIST.defaultTab, defaultSort: CONTACTS_LIST.defaultSort }}
        tabs={tabs}
        chips={CONTACTS_LIST.chips}
        fields={fields}
        allColumns={CONTACTS_LIST.columns}
        visibleColumns={visibleColumns}
        rows={rows}
        total={total}
        savedViews={savedViews}
        bulkUpdateModule={
          viewer.can("bulk:update") && viewer.can("contacts:update") && !viewer.impersonating
            ? "contacts"
            : undefined
        }
        searchPlaceholder={CONTACTS_LIST.searchPlaceholder}
        emptyState={
          <EmptyState
            icon={Users}
            title={hasFilters ? "No contacts match these filters" : "No contacts here yet"}
          >
            {hasFilters
              ? "Try removing a chip or a rule, or switch tabs."
              : "Contacts are added on an account. Open an account and choose Add contact."}
          </EmptyState>
        }
      />
    </div>
  );
}
