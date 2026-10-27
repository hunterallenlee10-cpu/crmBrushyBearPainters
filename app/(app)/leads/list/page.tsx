import type { Metadata } from "next";
import Link from "next/link";
import { Plus, UserRoundSearch } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GradeBadge, HotIcon, LeadStatusBadge } from "@/components/leads/lead-badges";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadLeadOptions } from "@/lib/leads/service";
import { LEADS_LIST as BASE_LEADS_LIST } from "@/lib/lists/modules/leads";
import { customCells } from "@/components/custom-fields/list-cells";
import { loadCustomFields } from "@/lib/custom-fields/server";
import { withCustomFields } from "@/lib/domain/custom-fields";

import { filterToOps } from "@/lib/lists/filters";
import { listOps, parseListState, resolveColumns } from "@/lib/lists/params";
import { applyOps, loadColumnPrefs, loadSavedViews, withOptions } from "@/lib/lists/server";
import { formatAppointment, formatDate, formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { formatDuration } from "@/lib/domain/leads/speed-to-lead";
import {
  HOME_BUILT_LABELS,
  SERVICE_LABELS,
  TIMELINE_LABELS,
  type Grade,
  type HomeBuilt,
  type LeadStatus,
  type Service,
  type Temperature,
  type Timeline,
} from "@/lib/domain/leads/constants";
import { LeadsListClient } from "./leads-list-client";

export const metadata: Metadata = { title: "Lead List" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SELECT =
  "id, first_name, last_name, company, mobile, phone, email, city, zip, out_of_area, services, status, disposition, timeline, home_built, lead_source, lead_sub_source, score, grade, temperature, walkthrough_at, created_at, last_activity_at, speed_to_lead_seconds, custom_field_values, owner:profiles!leads_owner_id_fkey(full_name)";

export default async function LeadListPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("leads:read");
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const customDefs = await loadCustomFields(supabase, "leads");
  const LEADS_LIST = withCustomFields(BASE_LEADS_LIST, customDefs);
  const state = parseListState(await searchParams, LEADS_LIST);

  const [options, savedViews, columnPrefs, countsRes] = await Promise.all([
    loadLeadOptions(supabase),
    loadSavedViews(supabase, "leads", viewer.real.id),
    loadColumnPrefs(supabase, viewer.real.id, "leads"),
    supabase.rpc("lead_status_counts"),
  ]);

  const fields = withOptions(LEADS_LIST.fields, options);
  const view = savedViews.find((v) => v.id === state.view);
  const visibleColumns = resolveColumns(LEADS_LIST, view?.config.columns ?? columnPrefs);
  const ops = listOps(
    state,
    LEADS_LIST,
    { userId: viewer.id, now },
    filterToOps(state.filter, fields, now),
  );

  const fromRow = (state.page - 1) * state.size;
  const query = applyOps(supabase.from("leads").select(SELECT, { count: "exact" }), ops)
    .order(state.sort, { ascending: state.dir === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(fromRow, fromRow + state.size - 1);
  const { data: leads, count, error } = await query;
  if (error) throw error;

  const counts = (countsRes.data ?? {}) as Record<string, number>;
  const userNames = new Map(options.users.map((u) => [u.value, u.label]));
  const label = (
    list: "lead_source" | "lead_sub_source" | "lead_disposition",
    value: string | null,
  ) => (value ? (options.picklists[list].find((o) => o.value === value)?.label ?? value) : null);

  const rows = (leads ?? []).map((l) => {
    const name = [l.first_name, l.last_name].filter(Boolean).join(" ");
    const phone = l.mobile ?? l.phone;
    return {
      id: l.id,
      label: name,
      cells: {
        name: (
          <div className="flex min-w-40 items-center gap-1.5">
            <Link href={`/leads/${l.id}`} className="font-medium text-bb-forest hover:underline">
              {name}
            </Link>
            <HotIcon temperature={l.temperature as Temperature | null} />
            {l.company && (
              <span className="truncate text-xs text-muted-foreground">· {l.company}</span>
            )}
          </div>
        ),
        score: <GradeBadge grade={l.grade as Grade | null} score={l.score} />,
        services: l.services.length ? (
          <span className="text-xs">
            {(l.services as Service[]).map((s) => SERVICE_LABELS[s]).join(", ")}
          </span>
        ) : null,
        contact:
          phone || l.email ? (
            <div className="flex flex-col text-xs">
              {phone && (
                <span className="whitespace-nowrap tabular-nums">{formatPhone(phone)}</span>
              )}
              {l.email && (
                <span className="max-w-52 truncate text-muted-foreground">{l.email}</span>
              )}
            </div>
          ) : null,
        city:
          l.city || l.out_of_area ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {l.city}
              {l.out_of_area && <Badge variant="warning">Out of area</Badge>}
            </span>
          ) : null,
        status: <LeadStatusBadge status={l.status as LeadStatus} />,
        walkthrough: l.walkthrough_at ? (
          <span className="text-xs whitespace-nowrap">{formatAppointment(l.walkthrough_at)}</span>
        ) : null,
        source: (
          <div className="flex flex-col text-xs">
            <span>{label("lead_source", l.lead_source)}</span>
            {l.lead_sub_source && (
              <span className="text-muted-foreground">
                {label("lead_sub_source", l.lead_sub_source)}
              </span>
            )}
          </div>
        ),
        created: (
          <span className="text-xs whitespace-nowrap" title={formatDate(l.created_at)}>
            {formatRelative(l.created_at, now)}
          </span>
        ),
        last_activity: (
          <span className="text-xs whitespace-nowrap" title={formatDate(l.last_activity_at)}>
            {formatRelative(l.last_activity_at, now)}
          </span>
        ),
        owner: l.owner?.full_name ? (
          <span className="text-xs whitespace-nowrap">{l.owner.full_name}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        ),
        disposition: l.disposition ? (
          <span className="text-xs">{label("lead_disposition", l.disposition)}</span>
        ) : null,
        timeline: l.timeline ? (
          <span className="text-xs">{TIMELINE_LABELS[l.timeline as Timeline]}</span>
        ) : null,
        home_built: l.home_built ? (
          <span className="text-xs">{HOME_BUILT_LABELS[l.home_built as HomeBuilt]}</span>
        ) : null,
        zip: l.zip ? <span className="text-xs tabular-nums">{l.zip}</span> : null,
        speed_to_lead:
          l.speed_to_lead_seconds !== null ? (
            <span className="text-xs tabular-nums">{formatDuration(l.speed_to_lead_seconds)}</span>
          ) : null,
        ...customCells(customDefs, l.custom_field_values, userNames),
      },
    };
  });

  const tabs = LEADS_LIST.tabs.map((t) => ({
    id: t.id,
    label: t.label,
    count: counts[t.countKey] ?? null,
  }));
  const canCreate = viewer.can("leads:create") && !viewer.impersonating;
  const hasFilters = state.q !== "" || state.chips.length > 0 || state.filter.rules.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Lead List"
        description={
          <>
            Leads · {(counts.active ?? 0).toLocaleString("en-US")} active /{" "}
            {(counts.total ?? 0).toLocaleString("en-US")} total
          </>
        }
        actions={
          canCreate ? (
            <Button asChild variant="cta">
              <Link href="/leads/new">
                <Plus aria-hidden />
                New Lead
              </Link>
            </Button>
          ) : undefined
        }
      />
      <LeadsListClient
        state={state}
        defaults={{ defaultTab: LEADS_LIST.defaultTab, defaultSort: LEADS_LIST.defaultSort }}
        tabs={tabs}
        chips={LEADS_LIST.chips}
        fields={fields}
        allColumns={LEADS_LIST.columns}
        visibleColumns={visibleColumns}
        rows={rows}
        total={count}
        savedViews={savedViews}
        searchPlaceholder={LEADS_LIST.searchPlaceholder}
        sourceOptions={options.picklists.lead_source.map((o) => ({
          value: o.value,
          label: o.label,
        }))}
        territoryOptions={options.territories}
        userOptions={options.users}
        canAssign={viewer.can("leads:assign") && !viewer.impersonating}
        canUpdate={viewer.can("leads:update") && !viewer.impersonating}
        exportList={
          viewer.can("leads:export") && viewer.can("data:export") && !viewer.impersonating
            ? "leads"
            : undefined
        }
        bulkUpdateModule={
          viewer.can("bulk:update") && viewer.can("leads:update") && !viewer.impersonating
            ? "leads"
            : undefined
        }
        emptyState={
          <EmptyState
            icon={UserRoundSearch}
            title={hasFilters ? "No leads match these filters" : "No leads here yet"}
            action={
              canCreate && !hasFilters ? (
                <Button asChild variant="cta">
                  <Link href="/leads/new">
                    <Plus aria-hidden />
                    New Lead
                  </Link>
                </Button>
              ) : undefined
            }
          >
            {hasFilters
              ? "Try removing a chip or a rule, or switch tabs."
              : "Website leads land here automatically. You can also add one by hand."}
          </EmptyState>
        }
      />
    </div>
  );
}
