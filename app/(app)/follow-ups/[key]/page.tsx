import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import type { TemplateOption } from "@/components/messaging/template-picker";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { groupDispositions, type DispositionGroup } from "@/lib/domain/follow-ups";
import { loadListSettings, loadQueue } from "@/lib/follow-ups/lists";
import { PowerDialer } from "./power-dialer";

export const metadata: Metadata = { title: "Power dialer" };

/** One follow-up list in the power dialer (SPEC §11.4). */
export default async function FollowUpListPage({ params }: { params: Promise<{ key: string }> }) {
  const viewer = await requirePermission("leads:read");
  const { key } = await params;
  const supabase = await createSupabaseServerClient();
  const lists = await loadListSettings(supabase);
  const list = lists.find((l) => l.key === key);
  if (!list) notFound();
  const [queue, dispositions, templates] = await Promise.all([
    list.active ? loadQueue(supabase, list) : Promise.resolve([]),
    supabase
      .from("follow_up_dispositions")
      .select(
        "key, label, disposition_group, requires_callback, sets_do_not_contact, active, sort_order",
      )
      .eq("active", true)
      .order("sort_order"),
    supabase
      .from("message_templates")
      .select("key, name, channel")
      .eq("active", true)
      .eq("channel", "sms")
      .neq("category", "internal")
      .order("name"),
  ]);
  const groups = groupDispositions(
    (dispositions.data ?? []).map((d) => ({
      key: d.key,
      label: d.label,
      group: d.disposition_group as DispositionGroup,
      requiresCallback: d.requires_callback,
      setsDoNotContact: d.sets_do_not_contact,
    })),
  );

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title={list.name}
        description={
          <>
            {list.description}{" "}
            <Link href="/follow-ups" className="text-bb-forest underline">
              All lists
            </Link>
          </>
        }
      />
      {!list.active ? (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          This list is turned off in List settings.
        </p>
      ) : (
        <PowerDialer
          listKey={list.key}
          script={list.script}
          queue={queue}
          groups={groups}
          templates={(templates.data ?? []).map(
            (t) => ({ key: t.key, name: t.name, channel: "sms" }) satisfies TemplateOption,
          )}
          canSend={viewer.can("messages:send") && !viewer.impersonating}
        />
      )}
    </PageContainer>
  );
}
