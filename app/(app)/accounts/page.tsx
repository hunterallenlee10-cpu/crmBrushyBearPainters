import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CircleCheck, History, Sprout, Star } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { KpiCard } from "@/components/kpi/kpi-card";
import { Badge } from "@/components/ui/badge";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadLeadOptions } from "@/lib/leads/service";
import {
  ACCOUNTS_LIST as BASE_ACCOUNTS_LIST,
  accountSearchOps,
  cleanSearchTerm,
} from "@/lib/lists/modules/accounts";
import { customCells } from "@/components/custom-fields/list-cells";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { withCustomFields } from "@/lib/domain/custom-fields";

import { filterToOps } from "@/lib/lists/filters";
import { listOps, parseListState, resolveColumns } from "@/lib/lists/params";
import { applyOps, loadColumnPrefs, loadSavedViews, withOptions } from "@/lib/lists/server";
import { formatDate, formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import {
  ACCOUNT_TYPE_LABELS,
  type AccountStatus,
  type AccountType,
} from "@/lib/validation/accounts";
import { AccountStatusBadge } from "./_components/badges";
import { NewAccountDialog } from "./_components/new-account-dialog";
import { AccountsListClient } from "./accounts-list-client";

export const metadata: Metadata = { title: "Accounts" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SELECT =
  "id, display_name, account_type, status, is_referral_champion, tags, created_at, updated_at, custom_field_values, owner:profiles!accounts_owner_id_fkey(full_name), territory:territories!accounts_territory_id_fkey(name), primary_contact:contacts!accounts_primary_contact_fk(first_name, last_name, mobile, phone, email), properties(city, is_primary), leads(count)";

/** Most accounts an address search folds into the name search. */
const ADDRESS_MATCH_LIMIT = 200;

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("accounts:read");
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const customDefs = await loadCustomFields(supabase, "accounts");
  const ACCOUNTS_LIST = withCustomFields(BASE_ACCOUNTS_LIST, customDefs);
  const state = parseListState(await searchParams, ACCOUNTS_LIST);
  const term = cleanSearchTerm(state.q);

  // Counts for the KPI strip and tabs: one head-only count query each, over
  // every account the viewer can see (RLS), never the current page of rows.
  const count = (build?: (q: ReturnType<typeof head>) => ReturnType<typeof head>) =>
    (build ? build(head()) : head()).then((r) => r.count ?? 0);
  function head() {
    return supabase.from("accounts").select("id", { count: "exact", head: true });
  }

  const [options, savedViews, columnPrefs, counts, addressMatches] = await Promise.all([
    loadLeadOptions(supabase),
    loadSavedViews(supabase, "accounts", viewer.real.id),
    loadColumnPrefs(supabase, viewer.real.id, "accounts"),
    Promise.all([
      count(),
      count((q) => q.eq("status", "prospect")),
      count((q) => q.eq("status", "active_customer")),
      count((q) => q.eq("status", "past_customer")),
      count((q) => q.eq("status", "inactive")),
      count((q) => q.eq("owner_id", viewer.id)),
    ]).then(([total, prospect, active_customer, past_customer, inactive, mine]) => ({
      total,
      prospect,
      active_customer,
      past_customer,
      inactive,
      mine,
    })),
    // Address search: properties whose street/city/ZIP match → their accounts.
    term.length >= 3
      ? supabase
          .from("properties")
          .select("account_id")
          .ilike("search_text", `%${term}%`)
          .limit(ADDRESS_MATCH_LIMIT)
          .then((r) => [...new Set((r.data ?? []).map((p) => p.account_id))])
      : Promise.resolve<string[]>([]),
  ]);

  const fields = withOptions(ACCOUNTS_LIST.fields, options);
  const view = savedViews.find((v) => v.id === state.view);
  const visibleColumns = resolveColumns(ACCOUNTS_LIST, view?.config.columns ?? columnPrefs);
  const ops = [
    ...listOps(
      { ...state, q: "" },
      ACCOUNTS_LIST,
      { userId: viewer.id, now },
      filterToOps(state.filter, fields, now),
    ),
    ...(state.q.trim() ? accountSearchOps(state.q, addressMatches) : []),
  ];

  const fromRow = (state.page - 1) * state.size;
  const {
    data: accounts,
    count: total,
    error,
  } = await applyOps(supabase.from("accounts").select(SELECT, { count: "exact" }), ops)
    .order(state.sort, { ascending: state.dir === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(fromRow, fromRow + state.size - 1);
  if (error) throw error;

  const rows = (accounts ?? []).map((a) => {
    const pc = a.primary_contact;
    const pcName = pc ? [pc.first_name, pc.last_name].filter(Boolean).join(" ") : null;
    const pcPhone = pc ? (pc.mobile ?? pc.phone) : null;
    const primary = a.properties.find((p) => p.is_primary) ?? a.properties[0];
    const leadCount = a.leads[0]?.count ?? 0;
    return {
      id: a.id,
      label: a.display_name,
      cells: {
        name: (
          <div className="flex min-w-40 items-center gap-1.5">
            <Link href={`/accounts/${a.id}`} className="font-medium text-bb-forest hover:underline">
              {a.display_name}
            </Link>
            {a.is_referral_champion && (
              <Star
                className="size-3.5 fill-bb-honey text-bb-ink"
                aria-label="Referral champion"
                role="img"
              />
            )}
          </div>
        ),
        type: (
          <span className="text-xs whitespace-nowrap">
            {ACCOUNT_TYPE_LABELS[a.account_type as AccountType]}
          </span>
        ),
        status: <AccountStatusBadge status={a.status as AccountStatus} />,
        primary_contact: pcName ? (
          <div className="flex flex-col text-xs">
            <span className="whitespace-nowrap">{pcName}</span>
            {pcPhone && (
              <span className="whitespace-nowrap text-muted-foreground tabular-nums">
                {formatPhone(pcPhone)}
              </span>
            )}
          </div>
        ) : null,
        city:
          primary?.city || a.territory?.name ? (
            <div className="flex flex-col text-xs">
              {primary?.city && <span className="whitespace-nowrap">{primary.city}</span>}
              {a.territory?.name && a.territory.name !== primary?.city && (
                <span className="whitespace-nowrap text-muted-foreground">{a.territory.name}</span>
              )}
            </div>
          ) : null,
        owner: a.owner?.full_name ? (
          <span className="text-xs whitespace-nowrap">{a.owner.full_name}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
        leads: <span className="text-xs tabular-nums">{leadCount}</span>,
        created: (
          <span className="text-xs whitespace-nowrap" title={formatDate(a.created_at)}>
            {formatRelative(a.created_at, now)}
          </span>
        ),
        updated: (
          <span className="text-xs whitespace-nowrap" title={formatDate(a.updated_at)}>
            {formatRelative(a.updated_at, now)}
          </span>
        ),
        tags: a.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {a.tags.slice(0, 4).map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </span>
        ) : null,
        ...customCells(customDefs, a.custom_field_values),
      },
    };
  });

  const tabs = ACCOUNTS_LIST.tabs.map((t) => ({
    id: t.id,
    label: t.label,
    count: counts[t.countKey as keyof typeof counts] ?? null,
  }));
  const canCreate = viewer.canAll(["accounts:create", "contacts:create"]) && !viewer.impersonating;
  const hasFilters = state.q !== "" || state.chips.length > 0 || state.filter.rules.length > 0;
  const formOptions = {
    users: options.users,
    propertyTypes: options.picklists.property_type,
    sidingTypes: options.picklists.siding_type,
  };
  const newButton = canCreate ? (
    <NewAccountDialog options={formOptions} viewerId={viewer.id} />
  ) : undefined;
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Accounts"
        description="Households and customers, with their people and homes."
        actions={newButton}
      />
      <section aria-label="Account totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total accounts"
          value={fmt(counts.total)}
          caption="Every account you can see"
          icon={Building2}
          href="/accounts"
        />
        <KpiCard
          label="Active customers"
          value={fmt(counts.active_customer)}
          caption="Status: Active customer"
          icon={CircleCheck}
          tone="success"
          href="/accounts?tab=active_customer"
        />
        <KpiCard
          label="Prospects"
          value={fmt(counts.prospect)}
          caption="Status: Prospect"
          icon={Sprout}
          tone="info"
          href="/accounts?tab=prospect"
        />
        <KpiCard
          label="Past customers"
          value={fmt(counts.past_customer)}
          caption="Status: Past customer"
          icon={History}
          tone="warning"
          href="/accounts?tab=past_customer"
        />
      </section>
      <AccountsListClient
        state={state}
        defaults={{ defaultTab: ACCOUNTS_LIST.defaultTab, defaultSort: ACCOUNTS_LIST.defaultSort }}
        tabs={tabs}
        chips={ACCOUNTS_LIST.chips}
        fields={fields}
        allColumns={ACCOUNTS_LIST.columns}
        visibleColumns={visibleColumns}
        rows={rows}
        total={total}
        savedViews={savedViews}
        searchPlaceholder={ACCOUNTS_LIST.searchPlaceholder}
        territoryOptions={options.territories}
        userOptions={options.users}
        canAssign={viewer.can("accounts:update") && !viewer.impersonating}
        bulkUpdateModule={
          viewer.can("bulk:update") && viewer.can("accounts:update") && !viewer.impersonating
            ? "accounts"
            : undefined
        }
        emptyState={
          <EmptyState
            icon={Building2}
            title={hasFilters ? "No accounts match these filters" : "No accounts here yet"}
            action={!hasFilters ? newButton : undefined}
          >
            {hasFilters
              ? "Try removing a chip or a rule, or switch tabs."
              : "Accounts are households and customers. Add one, or convert a lead when it's ready."}
          </EmptyState>
        }
      />
    </div>
  );
}
