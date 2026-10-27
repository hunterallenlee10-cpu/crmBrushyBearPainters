import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatRelative } from "@/lib/format/dates";
import { loadThreads } from "@/lib/messaging/inbox";

export const metadata: Metadata = { title: "Messages" };

/**
 * Crew tab bar → Messages (SPEC §16 mobile): read-only conversations on the
 * jobs you're on, so the crew lead sees what the office told the customer and
 * what the customer said. Replies come from the office.
 */
export default async function FieldMessagesPage() {
  const viewer = await requirePermission("messages:read");
  const supabase = await createSupabaseServerClient();
  const list = await loadThreads(supabase, { tab: "all", userId: viewer.id, page: 1, kind: "job" });
  const canReply = viewer.can("messages:send");
  return (
    <PageContainer className="flex max-w-2xl flex-col gap-4">
      <PageHeader title="Messages" description="Customer messages on your jobs." />
      {list.items.length === 0 ? (
        <EmptyState icon={MessageSquareText} title="No messages yet">
          Texts and emails with the customers on your jobs show up here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.items.map((t) => (
            <li key={t.id}>
              <Link
                href={canReply ? `/messages?tab=all&t=${t.id}` : (t.href ?? "/field/today")}
                className="flex min-h-11 flex-col gap-0.5 rounded-2xl border bg-card p-3 hover:bg-muted/50"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={t.unread ? "font-semibold" : "font-medium"}>{t.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.lastAt ? formatRelative(t.lastAt) : ""}
                  </span>
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {t.lastDirection === "inbound" ? "Customer: " : ""}
                  {t.preview}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
