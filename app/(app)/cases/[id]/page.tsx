import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, MessageSquareText } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import {
  CasePriorityBadge,
  CaseSlaBadge,
  CaseStatusBadge,
  CaseTypeLabel,
} from "@/components/cases/case-badges";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadCase } from "@/lib/cases/load";
import { CASE_SOURCE_LABELS, isOpenCase, type CaseSource } from "@/lib/domain/cases";
import { formatDateTime } from "@/lib/format/dates";
import { loadActiveUsers } from "@/app/(app)/jobs/[id]/_sections/data";
import { CaseControls, CaseMessages, CaseVisitForm } from "./case-controls";

export const metadata: Metadata = { title: "Case" };

/** One warranty or service case (SPEC §8.16): SLA, visits, customer updates, resolution. */
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requirePermission("cases:read");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const c = await loadCase(supabase, id, now);
  if (!c) notFound();
  const canManage = viewer.can("cases:manage") && !viewer.impersonating;
  const canBook = canManage && viewer.can("appointments:manage");
  const canMessage = viewer.can("messages:send") && !viewer.impersonating;
  const [users, jobs] = await Promise.all([
    canManage ? loadActiveUsers() : Promise.resolve([]),
    canManage && !c.job && c.account
      ? supabase
          .from("jobs")
          .select("id, name, job_number")
          .eq("account_id", c.account.id)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as { id: string; name: string; job_number: string }[] }),
  ]);
  const open = isOpenCase(c.status);

  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title={c.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{c.number}</span>
            <span aria-hidden>·</span>
            <CaseTypeLabel type={c.type} />
            <CaseStatusBadge status={c.status} />
            <CasePriorityBadge priority={c.priority} />
            <CaseSlaBadge status={c.status} slaDueAt={c.slaDueAt} now={now} />
          </span>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex flex-col gap-4">
          <section aria-labelledby="case-details" className="rounded-2xl border bg-card p-5">
            <h2 id="case-details" className="mb-3 text-base font-semibold">
              Details
            </h2>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Job</dt>
                <dd>
                  {c.job ? (
                    <Link href={`/jobs/${c.job.id}`} className="text-bb-forest underline">
                      {c.job.name} · {c.job.number}
                    </Link>
                  ) : (
                    "Not linked to a job"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Customer</dt>
                <dd>
                  {c.account ? (
                    <Link href={`/accounts/${c.account.id}`} className="text-bb-forest underline">
                      {c.account.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contact</dt>
                <dd>{c.contact ? c.contact.name : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">How it came in</dt>
                <dd>{CASE_SOURCE_LABELS[c.source as CaseSource] ?? c.source}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Opened</dt>
                <dd>
                  <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">SLA due</dt>
                <dd className={c.overdue ? "font-medium text-danger" : undefined}>
                  <time dateTime={c.slaDueAt}>{formatDateTime(c.slaDueAt)}</time>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">First response</dt>
                <dd>{c.firstResponseAt ? formatDateTime(c.firstResponseAt) : "Not yet"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>{c.ownerName ?? "Nobody yet"}</dd>
              </div>
            </dl>
            {c.description && (
              <p className="mt-4 text-sm break-words whitespace-pre-wrap">{c.description}</p>
            )}
            {c.resolution && (
              <div className="mt-4 rounded-xl border border-success/30 bg-success-bg p-3 text-sm">
                <p className="font-medium text-success">
                  Resolved{c.resolvedAt ? ` ${formatDateTime(c.resolvedAt)}` : ""}
                </p>
                <p className="mt-1 break-words whitespace-pre-wrap">{c.resolution}</p>
              </div>
            )}
          </section>

          <section aria-labelledby="case-visits" className="rounded-2xl border bg-card p-5">
            <h2 id="case-visits" className="mb-3 flex items-center gap-2 text-base font-semibold">
              <CalendarClock className="size-4" aria-hidden /> Warranty visits
            </h2>
            {c.visits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No visit booked yet.</p>
            ) : (
              <ul className="mb-4 flex flex-col gap-2 text-sm">
                {c.visits.map((v) => (
                  <li key={v.id} className="rounded-xl border bg-background p-3">
                    <p className="font-medium">
                      <time dateTime={v.startsAt}>{formatDateTime(v.startsAt)}</time>
                      <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                        {v.status.replaceAll("_", " ")}
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      {v.who.join(", ") || "Nobody assigned"}
                      {v.location ? ` · ${v.location}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {open && canBook && c.job && (
              <CaseVisitForm caseId={c.id} users={users} canMessage={canMessage} />
            )}
            {open && canBook && !c.job && (
              <p className="text-sm text-muted-foreground">
                Visits are booked on a job. Link this case to one of the customer&apos;s jobs first.
              </p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {canManage && (
            <CaseControls
              id={c.id}
              status={c.status}
              priority={c.priority}
              ownerId={c.ownerId}
              users={users}
              jobs={(jobs.data ?? []).map((j) => ({
                value: j.id,
                label: `${j.name} · ${j.job_number}`,
              }))}
              hasJob={!!c.job}
            />
          )}
          {canMessage && (c.job || c.contact) && (
            <section aria-labelledby="case-messages" className="rounded-2xl border bg-card p-5">
              <h2
                id="case-messages"
                className="mb-1 flex items-center gap-2 text-base font-semibold"
              >
                <MessageSquareText className="size-4" aria-hidden /> Update the customer
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">
                Uses the warranty templates (Admin → Messaging &amp; Templates). Consent and Do Not
                Contact apply; while texting and email aren&apos;t connected, it&apos;s recorded as
                “Simulated – not sent”.
              </p>
              <CaseMessages caseId={c.id} hasVisit={c.visits.length > 0} />
              {c.job && (
                <Link
                  href={`/jobs/${c.job.id}?section=messages`}
                  className="mt-3 inline-block text-sm text-bb-forest underline"
                >
                  See the job&apos;s messages
                </Link>
              )}
            </section>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
