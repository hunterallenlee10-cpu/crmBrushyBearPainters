"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, HardHat, Plus, ShieldAlert, ShieldCheck, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/layout/empty-state";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { createSupabaseBrowserClient } from "@/lib/db/browser";
import { formatDay } from "@/lib/domain/scheduling/dates";
import {
  finishSubDocumentUpload,
  saveSubcontractor,
  setSubcontractorStatus,
  startSubDocumentUpload,
} from "./actions";

export type SubRow = {
  id: string;
  companyName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  lniRegistration: string | null;
  lniExpiresOn: string | null;
  coiCarrier: string | null;
  coiExpiresOn: string | null;
  w9OnFile: boolean;
  bondOnFile: boolean;
  bondExpiresOn: string | null;
  rrpCertification: string | null;
  rrpExpiresOn: string | null;
  status: "active" | "expiring" | "suspended";
  suspendedReason: string | null;
  notes: string | null;
  issues: { level: "expired" | "expiring"; message: string }[];
  crews: string[];
  documents: {
    id: string;
    kind: string;
    title: string;
    expiresOn: string | null;
    createdAt: string;
  }[];
};

const STATUS: Record<
  SubRow["status"],
  { label: string; variant: "success" | "warning" | "danger" }
> = {
  active: { label: "Active", variant: "success" },
  expiring: { label: "Needs paperwork", variant: "warning" },
  suspended: { label: "Suspended", variant: "danger" },
};

const KIND_LABELS: Record<string, string> = {
  coi: "Insurance (COI)",
  lni: "L&I registration",
  w9: "W-9",
  bond: "Bond",
  rrp: "RRP certificate",
  other: "Other",
};

type Form = {
  id?: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  lniRegistration: string;
  lniExpiresOn: string;
  coiCarrier: string;
  coiExpiresOn: string;
  w9OnFile: boolean;
  bondOnFile: boolean;
  bondExpiresOn: string;
  rrpCertification: string;
  rrpExpiresOn: string;
  notes: string;
};

const blank: Form = {
  companyName: "",
  contactName: "",
  phone: "",
  email: "",
  lniRegistration: "",
  lniExpiresOn: "",
  coiCarrier: "",
  coiExpiresOn: "",
  w9OnFile: false,
  bondOnFile: false,
  bondExpiresOn: "",
  rrpCertification: "",
  rrpExpiresOn: "",
  notes: "",
};

function toForm(r: SubRow): Form {
  return {
    id: r.id,
    companyName: r.companyName,
    contactName: r.contactName ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    lniRegistration: r.lniRegistration ?? "",
    lniExpiresOn: r.lniExpiresOn ?? "",
    coiCarrier: r.coiCarrier ?? "",
    coiExpiresOn: r.coiExpiresOn ?? "",
    w9OnFile: r.w9OnFile,
    bondOnFile: r.bondOnFile,
    bondExpiresOn: r.bondExpiresOn ?? "",
    rrpCertification: r.rrpCertification ?? "",
    rrpExpiresOn: r.rrpExpiresOn ?? "",
    notes: r.notes ?? "",
  };
}

function SubDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Form;
}) {
  const [f, setF] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useRunAction();
  React.useEffect(() => {
    if (open) {
      setF(initial);
      setErrors({});
    }
  }, [open, initial]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: keyof Form, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <Field id={`sub-${k}`} label={label} error={errors[k]}>
      <Input
        value={String(f[k] ?? "")}
        onChange={(e) => set(k, e.target.value as never)}
        {...fieldAria(`sub-${k}`, errors[k])}
        {...extra}
      />
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{f.id ? "Edit subcontractor" : "New subcontractor"}</DialogTitle>
          <DialogDescription>
            Expiry dates drive the compliance status and the Attention reminders 30 days ahead.
          </DialogDescription>
        </DialogHeader>
        <form
          id="sub-form"
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveSubcontractor({
                  ...f,
                  lniExpiresOn: f.lniExpiresOn || null,
                  coiExpiresOn: f.coiExpiresOn || null,
                  bondExpiresOn: f.bondExpiresOn || null,
                  rrpExpiresOn: f.rrpExpiresOn || null,
                }),
              {
                success: "Subcontractor saved.",
                onOk: () => onOpenChange(false),
                onError: (err) => setErrors(firstErrors(err)),
              },
            );
          }}
        >
          {text("companyName", "Company")}
          {text("contactName", "Contact")}
          {text("phone", "Phone", { type: "tel" })}
          {text("email", "Email", { type: "email" })}
          {text("lniRegistration", "WA L&I registration #")}
          {text("lniExpiresOn", "L&I registration expires", { type: "date" })}
          {text("coiCarrier", "Insurance carrier")}
          {text("coiExpiresOn", "Insurance (COI) expires", { type: "date" })}
          {text("rrpCertification", "RRP certification #")}
          {text("rrpExpiresOn", "RRP certification expires", { type: "date" })}
          {text("bondExpiresOn", "Bond expires", { type: "date" })}
          <div className="flex flex-col justify-end gap-2">
            <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
              <input
                type="checkbox"
                className="size-4 accent-bb-forest"
                checked={f.w9OnFile}
                onChange={(e) => set("w9OnFile", e.target.checked)}
              />
              W-9 on file
            </label>
            <label className="inline-flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
              <input
                type="checkbox"
                className="size-4 accent-bb-forest"
                checked={f.bondOnFile}
                onChange={(e) => set("bondOnFile", e.target.checked)}
              />
              Bond on file
            </label>
          </div>
          <Field id="sub-notes" label="Notes" className="sm:col-span-2">
            <Textarea
              id="sub-notes"
              rows={3}
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="sub-form" disabled={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadPaperwork({ sub }: { sub: SubRow }) {
  const router = useRouter();
  const [kind, setKind] = React.useState("coi");
  const [expires, setExpires] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const start = await startSubDocumentUpload({
        subcontractorId: sub.id,
        fileName: file.name.slice(-200),
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!start.ok) return setError(start.error.message);
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from(start.data.bucket)
        .uploadToSignedUrl(start.data.path, start.data.token, file, { contentType: file.type });
      if (upErr) return setError("The upload didn't finish. Try again.");
      const done = await finishSubDocumentUpload({
        subcontractorId: sub.id,
        path: start.data.path,
        fileName: file.name.slice(-200),
        mimeType: file.type,
        kind: kind as "coi",
        title: `${KIND_LABELS[kind] ?? "Document"} – ${sub.companyName}`.slice(0, 200),
        expiresOn: expires || undefined,
      });
      if (!done.ok) return setError(done.error.message);
      setExpires("");
      router.refresh();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const id = `up-${sub.id}`;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-3">
      <Field id={`${id}-kind`} label="Paperwork" className="w-44">
        <NativeSelect id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`${id}-exp`} label="Expires (optional)" className="w-44">
        <Input
          id={`${id}-exp`}
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
        />
      </Field>
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        id={`${id}-file`}
        aria-label={`Upload paperwork for ${sub.companyName}`}
        accept=".pdf,image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Upload aria-hidden /> {busy ? "Uploading…" : "Upload file"}
      </Button>
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function SuspendButton({ sub }: { sub: SubRow }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { pending, run } = useRunAction();
  if (sub.status === "suspended") {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(() => setSubcontractorStatus({ id: sub.id, suspended: false }), {
            success: "Reinstated.",
          })
        }
      >
        Reinstate
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Suspend
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {sub.companyName}</DialogTitle>
            <DialogDescription>
              Their crews can&apos;t be scheduled until you reinstate them.
            </DialogDescription>
          </DialogHeader>
          <Field id={`susp-${sub.id}`} label="Why">
            <Textarea
              id={`susp-${sub.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(() => setSubcontractorStatus({ id: sub.id, suspended: true, reason }), {
                  success: "Suspended.",
                  onOk: () => setOpen(false),
                })
              }
            >
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SubcontractorsClient({
  rows,
  canEdit,
  openId,
}: {
  rows: SubRow[];
  canEdit: boolean;
  openId: string | null;
}) {
  const [editing, setEditing] = React.useState<Form | null>(null);
  React.useEffect(() => {
    if (!openId) return;
    document.getElementById(`sub-${openId}`)?.scrollIntoView({ block: "center" });
  }, [openId]);
  const dateOrDash = (d: string | null) => (d ? formatDay(d) : "—");
  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <Button onClick={() => setEditing({ ...blank })}>
            <Plus aria-hidden /> New subcontractor
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={HardHat} title="No subcontractors yet">
          <p>
            Add a subcontractor with their L&amp;I registration and insurance dates, then make a
            crew for them in Resources.
          </p>
        </EmptyState>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {rows.map((s) => {
            const st = STATUS[s.status];
            return (
              <li
                key={s.id}
                id={`sub-${s.id}`}
                className={`flex flex-col gap-3 rounded-2xl border bg-card p-4 ${openId === s.id ? "ring-2 ring-bb-honey" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{s.companyName}</h2>
                    <p className="text-sm text-muted-foreground">
                      {[s.contactName, s.phone, s.email].filter(Boolean).join(" · ") ||
                        "No contact details"}
                    </p>
                    {s.crews.length > 0 && (
                      <p className="text-xs text-muted-foreground">Crews: {s.crews.join(", ")}</p>
                    )}
                  </div>
                  <Badge variant={st.variant}>
                    {s.status === "active" ? (
                      <ShieldCheck aria-hidden />
                    ) : (
                      <ShieldAlert aria-hidden />
                    )}
                    {st.label}
                  </Badge>
                </div>
                {s.status === "suspended" && s.suspendedReason && (
                  <p className="text-sm text-danger">Suspended: {s.suspendedReason}</p>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">L&amp;I #</dt>
                    <dd>{s.lniRegistration ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">L&amp;I expires</dt>
                    <dd>{dateOrDash(s.lniExpiresOn)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">COI expires</dt>
                    <dd>{dateOrDash(s.coiExpiresOn)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">W-9</dt>
                    <dd>{s.w9OnFile ? "On file" : "Missing"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Bond</dt>
                    <dd>{s.bondOnFile ? dateOrDash(s.bondExpiresOn) : "None"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">RRP cert</dt>
                    <dd>
                      {s.rrpCertification
                        ? `${s.rrpCertification} · ${dateOrDash(s.rrpExpiresOn)}`
                        : "—"}
                    </dd>
                  </div>
                </dl>
                {s.issues.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {s.issues.map((i) => (
                      <li
                        key={i.message}
                        className={i.level === "expired" ? "text-danger" : "text-warning"}
                      >
                        {i.message}
                      </li>
                    ))}
                  </ul>
                )}
                {s.documents.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {s.documents.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground" aria-hidden />
                        <a
                          className="text-bb-forest underline"
                          href={`/api/files/subcontractors/${d.id}`}
                        >
                          {d.title}
                        </a>
                        {d.expiresOn && (
                          <span className="text-xs text-muted-foreground">
                            expires {formatDay(d.expiresOn)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <>
                    <UploadPaperwork sub={s} />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEditing(toForm(s))}>
                        Edit
                      </Button>
                      <SuspendButton sub={s} />
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <SubDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        initial={editing ?? blank}
      />
    </div>
  );
}
