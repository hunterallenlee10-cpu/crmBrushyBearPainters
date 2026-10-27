import { CheckCircle2, CircleDashed, ListTodo } from "lucide-react";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { signoffStatement } from "@/lib/domain/scheduling/messages";
import { formatAppointment, formatDateTime } from "@/lib/format/dates";
import { loadPunchSection } from "@/lib/production/job";
import type { JobDetailData } from "../types";
import { PunchList, SignoffCapture } from "./punch-client";

/** Job → Punch List (SPEC §8.5 #13, §1.3 final walkthrough). */
export async function PunchListSection({ data }: { data: JobDetailData }) {
  const viewer = await requireViewer();
  const { job } = data;
  const supabase = await createSupabaseServerClient();
  const service = await createSupabaseServiceClient({ actorId: viewer.id });
  const p = await loadPunchSection({ supabase, service }, { jobId: job.id });
  const canManage = !data.readOnly && viewer.can("punch_list:manage");
  const open = p.items.filter((i) => i.status === "open").length;
  const walkthroughs = data.appointments.filter((a) => a.type === "final_walkthrough");
  const doneWalk = walkthroughs.find((a) => a.status === "completed") ?? null;
  const nextWalk = walkthroughs.find((a) => a.status === "scheduled") ?? null;
  const signed = p.signoffs[0] ?? null;
  const canSign =
    canManage && !signed && ["in_progress", "final_walkthrough", "completed"].includes(job.stage);
  const steps = [
    {
      label: "Final walkthrough booked",
      done: walkthroughs.length > 0,
      detail: nextWalk
        ? formatAppointment(nextWalk.startsAt)
        : doneWalk
          ? formatAppointment(doneWalk.startsAt)
          : "Book it in Schedule → Appointments",
    },
    {
      label: "Walkthrough done",
      done: !!doneWalk,
      detail: doneWalk ? "Marked complete" : "Mark the appointment complete",
    },
    { label: "Punch items closed", done: open === 0, detail: open ? `${open} open` : "None open" },
    {
      label: "Customer sign-off",
      done: !!signed,
      detail: signed ? `${signed.signerName} · ${formatDateTime(signed.signedAt)}` : "Not captured",
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Final walkthrough" className="rounded-2xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <ListTodo className="size-4" aria-hidden /> Final walkthrough
          </h3>
          {canSign && (
            <SignoffCapture
              jobId={job.id}
              defaultName={job.contact?.name ?? ""}
              openItems={open}
              statement={signoffStatement(open)}
            />
          )}
        </div>
        <ol className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-2 rounded-xl border p-2">
              {s.done ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              ) : (
                <CircleDashed
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <span>
                <span className="block font-medium">{s.label}</span>
                <span className="text-xs text-muted-foreground">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          The job moves to Completed once the customer signs off, or once the walkthrough is done
          with no open items.
        </p>
        {signed && (
          <p className="mt-2 rounded-xl bg-muted/50 p-2 text-xs">
            “{signed.statement}”{signed.openItems ? ` · ${signed.openItems} open at signing` : ""}
            {signed.note ? ` · ${signed.note}` : ""}
          </p>
        )}
      </section>
      <PunchList jobId={job.id} items={p.items} photos={p.photos} canManage={canManage} />
    </div>
  );
}
