import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks, PhoneCall, Settings2 } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadListCounts, MEMBER_CAP } from "@/lib/follow-ups/lists";

export const metadata: Metadata = { title: "Follow-up Lists" };

/**
 * Follow-up Lists (SPEC §11.4): dynamic call lists that fill themselves from
 * leads, estimates and past customers. Open one to work it in the power
 * dialer: script, call or text, log the outcome, next.
 */
export default async function FollowUpsPage() {
  const viewer = await requirePermission("leads:read");
  const supabase = await createSupabaseServerClient();
  const lists = await loadListCounts(supabase);
  const active = lists.filter((l) => l.active);

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title="Follow-up Lists"
        description="Call lists that fill themselves. After you log an outcome, the record rests for the list's cooldown (or until its callback), so nobody gets called twice in a row."
        actions={
          viewer.can("settings:manage") ? (
            <Button asChild variant="outline">
              <Link href="/admin/follow-up-lists">
                <Settings2 className="size-4" aria-hidden /> List settings
              </Link>
            </Button>
          ) : null
        }
      />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {active.map((l) => (
          <li key={l.key}>
            <Link
              href={`/follow-ups/${l.key}`}
              className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors hover:border-bb-forest/40"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{l.name}</span>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-bb-forest">
                  <PhoneCall className="size-4" aria-hidden />
                </span>
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {l.count}
                {l.capped ? "+" : ""}
              </span>
              <span className="text-xs text-muted-foreground">{l.description}</span>
              {l.count === 0 && (
                <Badge variant="success" className="self-start">
                  All caught up
                </Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {active.length === 0 && (
        <p className="flex items-center gap-2 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          <ListChecks className="size-4" aria-hidden /> Every list is turned off in List settings.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Counts are live and include only records you can see; each list shows up to {MEMBER_CAP}.
      </p>
    </PageContainer>
  );
}
