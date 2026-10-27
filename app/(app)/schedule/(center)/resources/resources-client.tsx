"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { formatRange } from "@/lib/domain/scheduling/dates";
import {
  addCrewMember,
  addTimeOff,
  removeCrewMember,
  removeTimeOff,
  saveCrew,
  setCrewSkill,
} from "./actions";

export type CrewCard = {
  id: string;
  name: string;
  crewType: "employee" | "subcontractor";
  subcontractorId: string | null;
  leadUserId: string | null;
  color: string | null;
  homeTerritoryId: string | null;
  maxJobsPerDay: number;
  dailyCapacityHours: number;
  active: boolean;
  members: { id: string; name: string; role: string; userId: string | null }[];
  skills: { skillId: string; expiresOn: string | null }[];
  timeOff: {
    id: string;
    startsOn: string;
    endsOn: string;
    reason: string | null;
    who: string | null;
  }[];
};

type Opt = { id: string; name: string };
type Props = {
  crews: CrewCard[];
  skills: { id: string; label: string; isCertification: boolean }[];
  people: { id: string; full_name: string }[];
  territories: Opt[];
  subcontractors: { id: string; name: string; status: string }[];
  blackouts: { id: string; startsOn: string; endsOn: string; reason: string | null }[];
  can: { manage: boolean; timeOff: boolean };
};

type CrewForm = Omit<CrewCard, "members" | "skills" | "timeOff" | "id"> & { id?: string };
const NEW_CREW: CrewForm = {
  name: "",
  crewType: "employee",
  subcontractorId: null,
  leadUserId: null,
  color: "#1F4D3A",
  homeTerritoryId: null,
  maxJobsPerDay: 1,
  dailyCapacityHours: 8,
  active: true,
};

function CrewDialog({
  initial,
  onClose,
  props,
}: {
  initial: CrewForm | null;
  onClose: () => void;
  props: Props;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [f, setF] = React.useState<CrewForm>(initial ?? NEW_CREW);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (initial) {
      setF(initial);
      setErrors({});
    }
  }, [initial]);
  if (!initial) return null;
  const set = <K extends keyof CrewForm>(k: K, v: CrewForm[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{f.id ? `Edit ${initial.name}` : "New crew"}</DialogTitle>
          <DialogDescription>
            Crews get scheduled on the Master Schedule. Their members see the jobs they&apos;re on.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="crew-name" label="Name" error={errors.name} className="sm:col-span-2">
            <Input id="crew-name" value={f.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field id="crew-type" label="Type">
            <NativeSelect
              id="crew-type"
              value={f.crewType}
              onChange={(e) =>
                set("crewType", e.target.value === "subcontractor" ? "subcontractor" : "employee")
              }
            >
              <option value="employee">Our crew</option>
              <option value="subcontractor">Subcontractor</option>
            </NativeSelect>
          </Field>
          {f.crewType === "subcontractor" ? (
            <Field id="crew-sub" label="Subcontractor" error={errors.subcontractorId}>
              <NativeSelect
                id="crew-sub"
                value={f.subcontractorId ?? ""}
                onChange={(e) => set("subcontractorId", e.target.value || null)}
              >
                <option value="">Pick one</option>
                {props.subcontractors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <div />
          )}
          <Field id="crew-lead" label="Crew lead">
            <NativeSelect
              id="crew-lead"
              value={f.leadUserId ?? ""}
              onChange={(e) => set("leadUserId", e.target.value || null)}
            >
              <option value="">No lead</option>
              {props.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="crew-territory" label="Home territory">
            <NativeSelect
              id="crew-territory"
              value={f.homeTerritoryId ?? ""}
              onChange={(e) => set("homeTerritoryId", e.target.value || null)}
            >
              <option value="">None</option>
              {props.territories.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="crew-max" label="Jobs per day" description="1 unless the crew splits days.">
            <Input
              id="crew-max"
              type="number"
              min={1}
              max={5}
              value={f.maxJobsPerDay}
              onChange={(e) => set("maxJobsPerDay", Number(e.target.value))}
            />
          </Field>
          <Field id="crew-cap" label="Daily capacity (hours)">
            <Input
              id="crew-cap"
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={f.dailyCapacityHours}
              onChange={(e) => set("dailyCapacityHours", Number(e.target.value))}
            />
          </Field>
          <Field id="crew-color" label="Calendar color">
            <Input
              id="crew-color"
              type="color"
              value={f.color ?? "#1F4D3A"}
              onChange={(e) => set("color", e.target.value)}
            />
          </Field>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
            <input
              type="checkbox"
              className="size-4 accent-bb-forest"
              checked={f.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            Active
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => saveCrew(f), {
                success: "Crew saved.",
                onOk: () => {
                  onClose();
                  router.refresh();
                },
                onError: (e) => setErrors(firstErrors(e)),
              })
            }
          >
            Save crew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CrewPanel({ crew, props, onEdit }: { crew: CrewCard; props: Props; onEdit: () => void }) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [who, setWho] = React.useState("");
  const [typed, setTyped] = React.useState("");
  const [role, setRole] = React.useState<"lead" | "painter" | "helper">("painter");
  const [offFrom, setOffFrom] = React.useState("");
  const [offTo, setOffTo] = React.useState("");
  const [offWhy, setOffWhy] = React.useState("");
  const [offWho, setOffWho] = React.useState("");
  const ok = (msg: string) => ({ success: msg, onOk: () => router.refresh() });
  const lead = props.people.find((p) => p.id === crew.leadUserId)?.full_name;
  const sub = props.subcontractors.find((s) => s.id === crew.subcontractorId);
  return (
    <li
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4"
      data-testid={`crew-${crew.name}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">
            <span
              className="mr-2 inline-block size-3 rounded-full align-middle"
              style={{ background: crew.color ?? "#1F4D3A" }}
              aria-hidden
            />
            {crew.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {crew.crewType === "subcontractor" ? `Subcontractor: ${sub?.name ?? "—"}` : "Our crew"}{" "}
            · Lead: {lead ?? "none"} · {crew.maxJobsPerDay} job{crew.maxJobsPerDay === 1 ? "" : "s"}
            /day · {crew.dailyCapacityHours} h/day
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!crew.active && <Badge variant="neutral">Inactive</Badge>}
          {sub && sub.status !== "active" && (
            <Link href={`/admin/subcontractors?id=${sub.id}`}>
              <Badge variant={sub.status === "suspended" ? "danger" : "warning"}>
                {sub.status === "suspended" ? "Sub suspended" : "Sub paperwork"}
              </Badge>
            </Link>
          )}
          {props.can.manage && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              Edit
            </Button>
          )}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium">Members</h3>
        {crew.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one on this crew yet.</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-2">
            {crew.members.map((m) => (
              <li
                key={m.id}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm"
              >
                {m.name} <span className="text-xs text-muted-foreground">({m.role})</span>
                {props.can.manage && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name} from ${crew.name}`}
                    className="grid size-6 place-items-center rounded hover:bg-muted"
                    onClick={() => run(() => removeCrewMember({ memberId: m.id }), ok("Removed."))}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {props.can.manage && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field id={`m-who-${crew.id}`} label="Teammate" className="w-48">
              <NativeSelect
                id={`m-who-${crew.id}`}
                value={who}
                onChange={(e) => setWho(e.target.value)}
              >
                <option value="">Someone without a login…</option>
                {props.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {!who && (
              <Field id={`m-name-${crew.id}`} label="Name" className="w-40">
                <Input
                  id={`m-name-${crew.id}`}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </Field>
            )}
            <Field id={`m-role-${crew.id}`} label="Role" className="w-32">
              <NativeSelect
                id={`m-role-${crew.id}`}
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="lead">Lead</option>
                <option value="painter">Painter</option>
                <option value="helper">Helper</option>
              </NativeSelect>
            </Field>
            <Button
              variant="outline"
              disabled={pending || (!who && !typed.trim())}
              onClick={() =>
                run(
                  () =>
                    addCrewMember({
                      crewId: crew.id,
                      userId: who || undefined,
                      displayName: who ? undefined : typed,
                      role,
                    }),
                  {
                    ...ok("Added to the crew."),
                    onOk: () => {
                      setWho("");
                      setTyped("");
                      router.refresh();
                    },
                  },
                )
              }
            >
              <Plus aria-hidden /> Add member
            </Button>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium">Skills</h3>
        <ul className="mt-1 grid gap-1 sm:grid-cols-2">
          {props.skills.map((s) => {
            const has = crew.skills.find((x) => x.skillId === s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="inline-flex min-h-11 items-center gap-2 sm:min-h-0">
                  <input
                    type="checkbox"
                    className="size-4 accent-bb-forest"
                    checked={!!has}
                    disabled={!props.can.manage || pending}
                    onChange={(e) =>
                      run(
                        () =>
                          setCrewSkill({ crewId: crew.id, skillId: s.id, has: e.target.checked }),
                        ok(e.target.checked ? `${s.label} added.` : `${s.label} removed.`),
                      )
                    }
                  />
                  {s.label}
                </label>
                {has && s.isCertification && (
                  <>
                    <label htmlFor={`exp-${crew.id}-${s.id}`} className="sr-only">
                      {s.label} certificate expires
                    </label>
                    <Input
                      id={`exp-${crew.id}-${s.id}`}
                      type="date"
                      className="h-8 w-36"
                      defaultValue={has.expiresOn ?? ""}
                      disabled={!props.can.manage}
                      onBlur={(e) =>
                        e.target.value !== (has.expiresOn ?? "") &&
                        run(
                          () =>
                            setCrewSkill({
                              crewId: crew.id,
                              skillId: s.id,
                              has: true,
                              expiresOn: e.target.value || null,
                            }),
                          ok("Expiry saved."),
                        )
                      }
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-medium">Time off</h3>
        {crew.timeOff.length === 0 ? (
          <p className="text-sm text-muted-foreground">None coming up.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {crew.timeOff.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                {formatRange(t.startsOn, t.endsOn)} · {t.who ?? "Whole crew"}
                {t.reason ? ` · ${t.reason}` : ""}
                {props.can.timeOff && (
                  <button
                    type="button"
                    aria-label="Remove time off"
                    className="grid size-6 place-items-center rounded hover:bg-muted"
                    onClick={() => run(() => removeTimeOff({ id: t.id }), ok("Removed."))}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {props.can.timeOff && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field id={`to-who-${crew.id}`} label="Who" className="w-40">
              <NativeSelect
                id={`to-who-${crew.id}`}
                value={offWho}
                onChange={(e) => setOffWho(e.target.value)}
              >
                <option value="">Whole crew</option>
                {crew.members
                  .filter((m) => m.userId)
                  .map((m) => (
                    <option key={m.id} value={m.userId ?? ""}>
                      {m.name}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field id={`to-from-${crew.id}`} label="From" className="w-40">
              <Input
                id={`to-from-${crew.id}`}
                type="date"
                value={offFrom}
                onChange={(e) => setOffFrom(e.target.value)}
              />
            </Field>
            <Field id={`to-to-${crew.id}`} label="To" className="w-40">
              <Input
                id={`to-to-${crew.id}`}
                type="date"
                value={offTo}
                min={offFrom}
                onChange={(e) => setOffTo(e.target.value)}
              />
            </Field>
            <Field id={`to-why-${crew.id}`} label="Reason" className="w-40">
              <Input
                id={`to-why-${crew.id}`}
                value={offWhy}
                onChange={(e) => setOffWhy(e.target.value)}
              />
            </Field>
            <Button
              variant="outline"
              disabled={pending || !offFrom}
              onClick={() =>
                run(
                  () =>
                    addTimeOff({
                      kind: "time_off",
                      crewId: offWho ? undefined : crew.id,
                      userId: offWho || undefined,
                      startsOn: offFrom,
                      endsOn: offTo || offFrom,
                      reason: offWhy || undefined,
                    }),
                  {
                    success: "Time off added.",
                    onOk: () => {
                      setOffFrom("");
                      setOffTo("");
                      setOffWhy("");
                      router.refresh();
                    },
                  },
                )
              }
            >
              Add time off
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function ResourcesClient(props: Props) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [editing, setEditing] = React.useState<CrewForm | null>(null);
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [why, setWhy] = React.useState("");
  return (
    <div className="flex flex-col gap-4">
      {props.can.manage && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing({ ...NEW_CREW })}>
            <Plus aria-hidden /> New crew
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/subcontractors">Subcontractors</Link>
          </Button>
        </div>
      )}
      {props.crews.length === 0 ? (
        <EmptyState icon={Users} title="No crews yet">
          <p>
            Add your first crew, its lead and members, and tick the skills it has. Then you can
            schedule jobs on the Master Schedule.
          </p>
        </EmptyState>
      ) : (
        <ul className="grid gap-4 2xl:grid-cols-2">
          {props.crews.map((c) => (
            <CrewPanel
              key={c.id}
              crew={c}
              props={props}
              onEdit={() =>
                setEditing({
                  id: c.id,
                  name: c.name,
                  crewType: c.crewType,
                  subcontractorId: c.subcontractorId,
                  leadUserId: c.leadUserId,
                  color: c.color,
                  homeTerritoryId: c.homeTerritoryId,
                  maxJobsPerDay: c.maxJobsPerDay,
                  dailyCapacityHours: c.dailyCapacityHours,
                  active: c.active,
                })
              }
            />
          ))}
        </ul>
      )}
      <section aria-labelledby="blackouts" className="rounded-2xl border bg-card p-4">
        <h2 id="blackouts" className="text-base font-semibold">
          Company blackout dates
        </h2>
        <p className="text-sm text-muted-foreground">
          No crew is scheduled on these days (holidays, company events).
        </p>
        {props.blackouts.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {props.blackouts.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                {formatRange(b.startsOn, b.endsOn)}
                {b.reason ? ` · ${b.reason}` : ""}
                {props.can.timeOff && (
                  <button
                    type="button"
                    aria-label="Remove blackout"
                    className="grid size-6 place-items-center rounded hover:bg-muted"
                    onClick={() =>
                      run(() => removeTimeOff({ id: b.id }), {
                        success: "Removed.",
                        onOk: () => router.refresh(),
                      })
                    }
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {props.can.timeOff && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Field id="bo-from" label="From" className="w-40">
              <Input
                id="bo-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field id="bo-to" label="To" className="w-40">
              <Input
                id="bo-to"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
            <Field id="bo-why" label="Reason" className="w-48">
              <Input id="bo-why" value={why} onChange={(e) => setWhy(e.target.value)} />
            </Field>
            <Button
              variant="outline"
              disabled={pending || !from}
              onClick={() =>
                run(
                  () =>
                    addTimeOff({
                      kind: "blackout",
                      startsOn: from,
                      endsOn: to || from,
                      reason: why || undefined,
                    }),
                  {
                    success: "Blackout added.",
                    onOk: () => {
                      setFrom("");
                      setTo("");
                      setWhy("");
                      router.refresh();
                    },
                  },
                )
              }
            >
              Add blackout
            </Button>
          </div>
        )}
      </section>
      <CrewDialog initial={editing} onClose={() => setEditing(null)} props={props} />
    </div>
  );
}
