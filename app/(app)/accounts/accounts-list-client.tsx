"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ListShell, type ListShellProps } from "@/components/lists/list-shell";
import { useListNavigation } from "@/components/lists/use-list-navigation";
import type { FilterSpec, FieldOption } from "@/lib/lists/filters";
import { formatRelative } from "@/lib/format/dates";
import { formatPhone } from "@/lib/domain/leads/normalize";
import { ACCOUNT_TYPE_LABELS } from "@/lib/validation/accounts";
import { bulkAssignAccounts, getAccountPreview, type AccountPreview } from "./actions";
import {
  AccountStatusBadge,
  LeadSafeBadge,
  PrimaryBadge,
  ReferralChampionBadge,
} from "./_components/badges";

type Props = Omit<
  ListShellProps,
  "moduleId" | "noun" | "bulkActions" | "renderPreview" | "quickFilters"
> & {
  territoryOptions: FieldOption[];
  userOptions: FieldOption[];
  canAssign: boolean;
};

const selectClass =
  "h-9 rounded-md border border-input bg-card px-2 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";

function ruleValue(filter: FilterSpec, field: string): string {
  const r = filter.rules.find((x) => x.field === field && x.op === "equals");
  return typeof r?.value === "string" ? r.value : "";
}

function withRule(filter: FilterSpec, field: string, value: string): FilterSpec {
  const rules = filter.rules.filter((x) => !(x.field === field && x.op === "equals"));
  return { match: "all", rules: value ? [...rules, { field, op: "equals", value }] : rules };
}

function QuickFilters({ props }: { props: Props }) {
  const { go } = useListNavigation(props.state, props.defaults);
  return (
    <>
      <select
        aria-label="Territory"
        className={selectClass}
        value={ruleValue(props.state.filter, "territory")}
        onChange={(e) => go({ filter: withRule(props.state.filter, "territory", e.target.value) })}
      >
        <option value="">All territories</option>
        {props.territoryOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Owner"
        className={selectClass}
        value={ruleValue(props.state.filter, "owner")}
        onChange={(e) => go({ filter: withRule(props.state.filter, "owner", e.target.value) })}
      >
        <option value="">Any owner</option>
        {props.userOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}

function BulkActions({ ids, clear, props }: { ids: string[]; clear: () => void; props: Props }) {
  const router = useRouter();
  const [owner, setOwner] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function assign() {
    setBusy(true);
    const result = await bulkAssignAccounts({ ids, owner_id: owner || null });
    setBusy(false);
    if (!result.ok) return toast.error(result.error.message);
    const { updated, skipped } = result.data;
    toast.success(
      `Assigned ${updated} account${updated === 1 ? "" : "s"}.${skipped ? ` ${skipped} skipped (no access).` : ""}`,
    );
    setOpen(false);
    clear();
    router.refresh();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          <UserPlus aria-hidden />
          Assign owner
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-72 flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="bulk-account-owner">
          Assign {ids.length} to
        </label>
        <select
          id="bulk-account-owner"
          className={selectClass}
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        >
          <option value="">Unassigned</option>
          {props.userOptions.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={busy} onClick={assign}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          Assign
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function Preview({ id }: { id: string }) {
  const [account, setAccount] = React.useState<AccountPreview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let alive = true;
    setAccount(null);
    setError(null);
    void getAccountPreview({ id }).then((r) => {
      if (!alive) return;
      if (r.ok) setAccount(r.data);
      else setError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!account)
    return (
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading account" />
    );

  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words">{value}</dd>
      </div>
    ) : null;
  const pc = account.primaryContact;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <AccountStatusBadge status={account.status} />
        <span className="text-xs text-muted-foreground">{ACCOUNT_TYPE_LABELS[account.type]}</span>
        {account.isReferralChampion && <ReferralChampionBadge />}
      </div>
      <dl className="divide-y">
        {row("Primary contact", pc?.name)}
        {row("Mobile", pc?.mobile && formatPhone(pc.mobile))}
        {row("Phone", pc?.phone && formatPhone(pc.phone))}
        {row("Email", pc?.email)}
        {row("Owner", account.ownerName ?? "Unassigned")}
        {row("Territory", account.territoryName)}
        {row("Contacts", String(account.contactCount))}
        {row("Leads", String(account.leadCount))}
        {row("Tags", account.tags.join(", "))}
        {row("Created", formatRelative(account.createdAt))}
      </dl>
      {account.properties.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">Properties</h3>
          <ul className="mt-1 flex flex-col gap-1.5 text-sm">
            {account.properties.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-1.5">
                <span>{p.address}</span>
                {p.isPrimary && account.properties.length > 1 && <PrimaryBadge />}
                {p.leadSafe && <LeadSafeBadge />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {account.notes && (
        <div>
          <h3 className="text-sm font-semibold">Notes</h3>
          <p className="mt-1 text-sm whitespace-pre-line text-foreground/90">{account.notes}</p>
        </div>
      )}
      <Button asChild>
        <Link href={`/accounts/${account.id}`}>Open account</Link>
      </Button>
    </div>
  );
}

export function AccountsListClient(props: Props) {
  return (
    <ListShell
      {...props}
      moduleId="accounts"
      noun="account"
      quickFilters={<QuickFilters props={props} />}
      bulkActions={
        props.canAssign
          ? (ids, clear) => <BulkActions ids={ids} clear={clear} props={props} />
          : undefined
      }
      renderPreview={(id) => <Preview id={id} />}
    />
  );
}
