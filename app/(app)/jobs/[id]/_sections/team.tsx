"use client";

import * as React from "react";
import { Loader2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { TEAM_ROLES, TEAM_ROLE_LABELS, type TeamRole } from "@/lib/domain/jobs/constants";
import type { Option } from "@/lib/leads/service";
import { selectClass } from "@/app/(app)/leads/[id]/labels";
import { addTeammate, removeTeammate } from "./actions";

export type TeamRow = {
  userId: string;
  name: string;
  /** A job_team role, or the job's own owner / point of contact / PM fields. */
  role: TeamRole | "owner" | "job_point_of_contact" | "job_project_manager";
  removable: boolean;
};

const FIXED_LABELS: Record<Exclude<TeamRow["role"], TeamRole>, string> = {
  owner: "Owner / estimator",
  job_point_of_contact: "Point of contact",
  job_project_manager: "Project manager / crew lead",
};

function roleLabel(role: TeamRow["role"]): string {
  return role in FIXED_LABELS
    ? FIXED_LABELS[role as keyof typeof FIXED_LABELS]
    : TEAM_ROLE_LABELS[role as TeamRole];
}

function RemoveButton({ jobId, row }: { jobId: string; row: TeamRow }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={`Remove ${row.name} (${roleLabel(row.role)})`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await removeTeammate({
            job_id: jobId,
            user_id: row.userId,
            role: row.role as TeamRole,
          });
          if (r.ok) toast.success(`${row.name} removed from the team.`);
          else toast.error(r.error.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
    </Button>
  );
}

function AddTeammateForm({ jobId, users }: { jobId: string; users: Option[] }) {
  const [userId, setUserId] = React.useState("");
  const [role, setRole] = React.useState<TeamRole>("painter");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  return (
    <form
      noValidate
      className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!userId) return setError("Pick a teammate.");
        setError(undefined);
        startTransition(async () => {
          const r = await addTeammate({ job_id: jobId, user_id: userId, role });
          if (r.ok) {
            toast.success("Teammate added.");
            setUserId("");
          } else {
            setError(r.error.fieldErrors?.user_id?.[0]);
            toast.error(r.error.message);
          }
        });
      }}
    >
      <Field id="team-user" label="Teammate" error={error} className="min-w-0 flex-1">
        <select
          id="team-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className={selectClass}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "team-user-error" : undefined}
        >
          <option value="">Pick a teammate…</option>
          {users.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="team-role" label="Role" className="sm:w-56">
        <select
          id="team-role"
          value={role}
          onChange={(e) => setRole(e.target.value as TeamRole)}
          className={selectClass}
        >
          {TEAM_ROLES.map((r) => (
            <option key={r} value={r}>
              {TEAM_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
        Add teammate
      </Button>
    </form>
  );
}

/** Internal Team (SPEC §8.5 #10): the job's people; Add/Remove needs jobs:assign. */
export function InternalTeam({
  jobId,
  rows,
  canAssign,
  users,
}: {
  jobId: string;
  rows: TeamRow[];
  canAssign: boolean;
  users: Option[];
}) {
  return (
    <div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one is on this job yet.</p>
      ) : (
        <ul className="flex flex-col divide-y" aria-label="Internal team">
          {rows.map((r) => (
            <li
              key={`${r.userId}-${r.role}`}
              className="flex items-center justify-between gap-2 py-2 first:pt-0"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="font-medium break-words">{r.name}</span>
                <Badge variant={r.removable ? "outline" : "neutral"}>{roleLabel(r.role)}</Badge>
              </div>
              {canAssign && r.removable && <RemoveButton jobId={jobId} row={r} />}
            </li>
          ))}
        </ul>
      )}
      {canAssign ? (
        <AddTeammateForm jobId={jobId} users={users} />
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Owner, point of contact and project manager change in Job Details on the Overview.
        </p>
      )}
    </div>
  );
}
