import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Mail, MessageSquareText, Phone } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { ThreadView } from "@/components/messaging/thread-view";
import type { TemplateOption } from "@/components/messaging/template-picker";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatRelative } from "@/lib/format/dates";
import { contactBlockReason } from "@/lib/leads/messaging";
import { jobContactBlockReason } from "@/lib/jobs/messaging";
import {
  INBOX_PAGE,
  INBOX_TABS,
  loadThread,
  loadThreads,
  type InboxTab,
} from "@/lib/messaging/inbox";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Messages (SPEC §5.7, §8.3 Communications): every customer conversation you
 * can see, unread first by default. Opening one marks it read for everyone;
 * replies go out through the lead's or job's own rules (simulated).
 */
export default async function MessagesPage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requirePermission("messages:read");
  const sp = await searchParams;
  const tab: InboxTab = INBOX_TABS.some((t) => t.id === one(sp.tab))
    ? (one(sp.tab) as InboxTab)
    : "unread";
  const kind =
    one(sp.kind) === "job" || one(sp.kind) === "lead" ? (one(sp.kind) as "job" | "lead") : null;
  const page = Math.max(1, Math.min(200, Number.parseInt(one(sp.page) ?? "1", 10) || 1));
  const selected = one(sp.t);
  const supabase = await createSupabaseServerClient();
  const [list, thread, templates] = await Promise.all([
    loadThreads(supabase, { tab, userId: viewer.id, page, kind }),
    selected && /^[0-9a-f-]{36}$/i.test(selected)
      ? loadThread(supabase, selected)
      : Promise.resolve(null),
    supabase
      .from("message_templates")
      .select("key, name, channel")
      .eq("active", true)
      .neq("category", "internal")
      .order("name"),
  ]);
  const canReply = viewer.can("messages:send");

  // Consent for the reply box: the job's primary contact, or the lead itself.
  let blocks = { sms: null as string | null, email: null as string | null };
  if (thread?.subjectType === "job") {
    const { data: job } = await supabase
      .from("jobs")
      .select("lead_id")
      .eq("id", thread.subjectId)
      .maybeSingle();
    const { data: lead } = job?.lead_id
      ? await supabase.from("leads").select("disposition").eq("id", job.lead_id).maybeSingle()
      : { data: null };
    const recipient = thread.contact ? { ...thread.contact, phone: null } : null;
    blocks = {
      sms: jobContactBlockReason(recipient, "sms", { leadDisposition: lead?.disposition ?? null }),
      email: jobContactBlockReason(recipient, "email", {
        leadDisposition: lead?.disposition ?? null,
      }),
    };
  } else if (thread?.subjectType === "lead") {
    const { data: l } = await supabase
      .from("leads")
      .select("mobile, phone, email, disposition, sms_opted_out_at")
      .eq("id", thread.subjectId)
      .maybeSingle();
    if (l) {
      const r = { ...l, smsOptedOutAt: l.sms_opted_out_at };
      blocks = { sms: contactBlockReason(r, "sms"), email: contactBlockReason(r, "email") };
    }
  }

  const href = (p: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const merged = { tab, kind, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/messages?${q.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(list.total / INBOX_PAGE));

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Messages"
        description={`Customer texts and emails on leads and jobs. ${list.unread} unread. While texting and email aren't connected, replies are recorded as “Simulated – not sent”.`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Inbox filters" className="flex flex-wrap gap-1">
          {INBOX_TABS.map((t) => (
            <Link
              key={t.id}
              href={href({ tab: t.id, page: null, t: null })}
              aria-current={t.id === tab ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                t.id === tab ? "border-bb-forest bg-bb-forest text-white" : "hover:bg-muted",
              )}
            >
              {t.label}
              {t.id === "unread" ? ` (${list.unread})` : ""}
            </Link>
          ))}
        </nav>
        <nav aria-label="Record type" className="flex flex-wrap gap-1">
          {[
            { id: null, label: "Leads and jobs" },
            { id: "lead", label: "Leads" },
            { id: "job", label: "Jobs" },
          ].map((k) => (
            <Link
              key={k.label}
              href={href({ kind: k.id, page: null, t: null })}
              aria-current={k.id === kind ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                k.id === kind ? "bg-muted font-medium" : "hover:bg-muted",
              )}
            >
              {k.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <section
          aria-label="Conversations"
          className={cn("rounded-2xl border bg-card", thread && "hidden lg:block")}
        >
          {list.items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={tab === "unread" ? "All caught up!" : "No conversations yet"}
              className="m-3 py-8"
            >
              {tab === "unread"
                ? "Nothing unread. Customer replies show up here as soon as they arrive."
                : "Texts and emails with customers show up here."}
            </EmptyState>
          ) : (
            <ul>
              {list.items.map((t) => {
                const Icon =
                  t.lastChannel === "email"
                    ? Mail
                    : t.lastChannel === "call"
                      ? Phone
                      : MessageSquareText;
                return (
                  <li key={t.id} className="border-b last:border-0">
                    <Link
                      href={href({ t: t.id, page: String(page) })}
                      aria-current={t.id === thread?.id ? "true" : undefined}
                      className={cn(
                        "flex gap-3 px-3 py-3 hover:bg-muted/50",
                        t.id === thread?.id && "bg-muted",
                      )}
                    >
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full"
                        aria-hidden
                        style={{ background: t.unread ? "var(--bb-honey)" : "transparent" }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn("truncate", t.unread ? "font-semibold" : "font-medium")}
                          >
                            {t.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {t.lastAt ? formatRelative(t.lastAt) : ""}
                          </span>
                        </span>
                        <span className="block text-xs text-muted-foreground">{t.subtitle}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                          <Icon className="size-3.5 shrink-0" aria-hidden />
                          <span className="truncate">
                            {t.lastDirection === "outbound" ? "You: " : ""}
                            {t.preview}
                          </span>
                        </span>
                        {t.unread && <span className="sr-only">Unread</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <nav
              aria-label="Pages"
              className="flex items-center justify-between border-t px-3 py-2 text-sm"
            >
              {page > 1 ? (
                <Link href={href({ page: String(page - 1), t: null })}>Previous</Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link href={href({ page: String(page + 1), t: null })}>Next</Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </section>
        <section
          aria-label="Conversation"
          className={cn("min-w-0 rounded-2xl border bg-card p-4", !thread && "hidden lg:block")}
        >
          {thread ? (
            <>
              <Link
                href={href({ t: null })}
                className="mb-3 inline-block text-sm text-bb-forest underline lg:hidden"
              >
                ← All conversations
              </Link>
              <ThreadView
                thread={thread}
                canReply={canReply}
                readOnly={viewer.impersonating}
                blocks={blocks}
                templates={(templates.data ?? []).map(
                  (t) =>
                    ({
                      key: t.key,
                      name: t.name,
                      channel: t.channel === "email" ? "email" : "sms",
                    }) satisfies TemplateOption,
                )}
              />
            </>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Pick a conversation to read it and reply.
            </p>
          )}
        </section>
      </div>
    </PageContainer>
  );
}
