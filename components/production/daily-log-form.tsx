"use client";

import * as React from "react";
import { Camera, CheckCircle2, Plus, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, fieldAria } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { useOfflineSync } from "@/components/offline/offline-sync";
import { shrinkPhoto } from "@/components/photos/use-photo-capture";
import { PHOTO_UPLOAD_LIMIT } from "@/lib/domain/photos";

/**
 * New Daily Log (SPEC §8.5 #9, §1.3): mobile-first, one hand. "Cleanup done"
 * and a cleanup photo are required (a clean house every evening). The log
 * and its photos wait in the offline queue and upload when there's signal;
 * the server then records the customer update (simulated), signed by the
 * job's point of contact.
 */

export type DailyLogJob = {
  id: string;
  label: string;
  workOrders: { id: string; label: string }[];
  members: { userId: string | null; name: string }[];
};

type HoursRow = { key: string; who: string; hours: string };

export function DailyLogForm({
  jobs,
  defaultJobId,
  today,
  onQueued,
}: {
  jobs: DailyLogJob[];
  defaultJobId: string | null;
  today: string;
  onQueued?: () => void;
}) {
  const sync = useOfflineSync();
  const [jobId, setJobId] = React.useState(defaultJobId ?? jobs[0]?.id ?? "");
  const job = jobs.find((j) => j.id === jobId) ?? null;
  const [logDate, setLogDate] = React.useState(today);
  const [workOrderId, setWorkOrderId] = React.useState("");
  const [finished, setFinished] = React.useState("");
  const [nextUp, setNextUp] = React.useState("");
  const [issues, setIssues] = React.useState("");
  const [weather, setWeather] = React.useState("");
  const [cleanup, setCleanup] = React.useState(false);
  const [cleanupPhoto, setCleanupPhoto] = React.useState<File | null>(null);
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [hours, setHours] = React.useState<HoursRow[]>([]);
  const [newName, setNewName] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const cleanupRef = React.useRef<HTMLInputElement>(null);
  const photosRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setWorkOrderId("");
    setHours(
      (job?.members ?? []).map((m, i) => ({
        key: `${i}-${m.userId ?? m.name}`,
        who: m.userId ? `u:${m.userId}` : `n:${m.name}`,
        hours: "",
      })),
    );
  }, [job]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!jobId) e.job = "Pick the job.";
    if (finished.trim().length < 3) e.finished = "Say what got done today.";
    if (!cleanup) e.cleanup = "Check “Cleanup done” — a clean house every evening.";
    if (!cleanupPhoto) e.cleanupPhoto = "Take the cleanup photo.";
    for (const h of hours) {
      if (h.hours && !(Number(h.hours) > 0 && Number(h.hours) <= 24))
        e.hours = "Hours must be between 0 and 24.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate() || !cleanupPhoto || !job) return;
    if (!sync.ready) {
      toast.error("The upload queue is still starting. Try again in a moment.");
      return;
    }
    setBusy(true);
    try {
      const blob = await shrinkPhoto(cleanupPhoto);
      if (blob.size > PHOTO_UPLOAD_LIMIT) {
        setErrors({ cleanupPhoto: "That photo is too large (8 MB max)." });
        return;
      }
      const logId = crypto.randomUUID();
      const hoursJson = JSON.stringify(
        hours
          .filter((h) => Number(h.hours) > 0)
          .map((h) =>
            h.who.startsWith("u:")
              ? { userId: h.who.slice(2), hours: Number(h.hours) }
              : { name: h.who.slice(2) || "Crew member", hours: Number(h.hours) },
          ),
      );
      await sync.enqueue({
        id: logId,
        kind: "daily_log",
        jobId: job.id,
        blob,
        meta: {
          logDate,
          workOrderId: workOrderId || null,
          finishedToday: finished.trim(),
          nextUp: nextUp.trim() || null,
          issues: issues.trim() || null,
          weatherObserved: weather.trim() || null,
          hours: hoursJson,
          source: navigator.onLine ? "online" : "offline",
        },
      });
      for (const p of photos) {
        const b = await shrinkPhoto(p).catch(() => null);
        if (!b || b.size > PHOTO_UPLOAD_LIMIT) continue;
        await sync.enqueue({
          id: crypto.randomUUID(),
          kind: "photo",
          jobId: job.id,
          blob: b,
          meta: {
            fileName: "progress.jpg",
            category: "progress",
            caption: "Daily log",
            dailyLogId: logId,
            source: navigator.onLine ? "camera" : "offline",
          },
        });
      }
      const msg = navigator.onLine
        ? "Daily log sent. The customer update is recorded (simulated)."
        : "Saved on this phone. It will upload when you're back online.";
      setDone(msg);
      toast.success(msg);
      setFinished("");
      setNextUp("");
      setIssues("");
      setWeather("");
      setCleanup(false);
      setCleanupPhoto(null);
      setPhotos([]);
      onQueued?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!jobs.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No jobs to log today. Jobs you&apos;re on show here once they&apos;re scheduled.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      aria-label="New daily log"
    >
      {done && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/40 bg-success-bg p-3 text-sm text-success"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {done}
        </p>
      )}
      {!sync.online && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-bg p-3 text-sm"
        >
          <WifiOff className="size-4" aria-hidden /> You&apos;re offline. The log saves on this
          phone and uploads later.
        </p>
      )}
      <Field id="dl-job" label="Job" error={errors.job} required>
        <NativeSelect
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          {...fieldAria("dl-job", errors.job)}
        >
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dl-date" label="Date">
          <Input
            id="dl-date"
            type="date"
            value={logDate}
            max={today}
            onChange={(e) => setLogDate(e.target.value)}
            className="h-11"
          />
        </Field>
        {job && job.workOrders.length > 0 && (
          <Field id="dl-wo" label="Work order">
            <NativeSelect
              id="dl-wo"
              value={workOrderId}
              onChange={(e) => setWorkOrderId(e.target.value)}
            >
              <option value="">Whole job</option>
              {job.workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>
      <Field id="dl-finished" label="Finished today" error={errors.finished} required>
        <Textarea
          rows={3}
          value={finished}
          onChange={(e) => setFinished(e.target.value)}
          {...fieldAria("dl-finished", errors.finished)}
        />
      </Field>
      <Field id="dl-next" label="Next up">
        <Textarea
          id="dl-next"
          rows={2}
          value={nextUp}
          onChange={(e) => setNextUp(e.target.value)}
        />
      </Field>
      <Field id="dl-issues" label="Issues or blockers (internal)">
        <Textarea
          id="dl-issues"
          rows={2}
          value={issues}
          onChange={(e) => setIssues(e.target.value)}
        />
      </Field>
      <Field id="dl-weather" label="Weather on site">
        <Input
          id="dl-weather"
          className="h-11"
          value={weather}
          onChange={(e) => setWeather(e.target.value)}
          placeholder="e.g. Dry, 64°F"
        />
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Hours</legend>
        {hours.map((h, i) => (
          <div key={h.key} className="flex items-center gap-2">
            <label htmlFor={`dl-h-${i}`} className="min-w-0 flex-1 truncate text-sm">
              {h.who.startsWith("u:")
                ? (job?.members.find((m) => m.userId === h.who.slice(2))?.name ?? "Teammate")
                : h.who.slice(2) || "Crew member"}
            </label>
            <Input
              id={`dl-h-${i}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              step={0.25}
              className="h-11 w-24"
              value={h.hours}
              onChange={(e) =>
                setHours((rows) =>
                  rows.map((r) => (r.key === h.key ? { ...r, hours: e.target.value } : r)),
                )
              }
            />
            <button
              type="button"
              aria-label="Remove row"
              className="grid size-11 place-items-center rounded hover:bg-muted"
              onClick={() => setHours((rows) => rows.filter((r) => r.key !== h.key))}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <label htmlFor="dl-new-person" className="sr-only">
            Add someone by name
          </label>
          <Input
            id="dl-new-person"
            className="h-11 flex-1"
            placeholder="Add someone by name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={!newName.trim()}
            onClick={() => {
              const name = newName.trim();
              setHours((rows) => [...rows, { key: `${Date.now()}`, who: `n:${name}`, hours: "" }]);
              setNewName("");
            }}
          >
            <Plus aria-hidden /> Add
          </Button>
        </div>
        {errors.hours && <p className="text-xs text-danger">{errors.hours}</p>}
      </fieldset>
      <div className="flex flex-col gap-2 rounded-xl border p-3">
        <label className="inline-flex min-h-11 items-center gap-3 text-base font-medium">
          <input
            type="checkbox"
            className="size-6 accent-bb-forest"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
            aria-describedby={errors.cleanup ? "dl-cleanup-error" : undefined}
          />
          Cleanup done
        </label>
        {errors.cleanup && (
          <p id="dl-cleanup-error" role="alert" className="text-xs text-danger">
            {errors.cleanup}
          </p>
        )}
        <input
          ref={cleanupRef}
          id="dl-cleanup-photo"
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          aria-label="Cleanup photo"
          onChange={(e) => setCleanupPhoto(e.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          onClick={() => cleanupRef.current?.click()}
        >
          <Camera aria-hidden /> {cleanupPhoto ? "Retake cleanup photo" : "Cleanup photo"}
        </Button>
        {cleanupPhoto && (
          <p className="text-xs text-muted-foreground">Photo ready: {cleanupPhoto.name}</p>
        )}
        {errors.cleanupPhoto && (
          <p role="alert" className="text-xs text-danger">
            {errors.cleanupPhoto}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={photosRef}
          id="dl-photos"
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Progress photos"
          onChange={(e) => setPhotos(Array.from(e.target.files ?? []))}
        />
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          onClick={() => photosRef.current?.click()}
        >
          <Camera aria-hidden /> Progress photos{photos.length ? ` (${photos.length})` : ""}
        </Button>
      </div>
      <Button
        type="submit"
        className="h-12 bg-bb-honey text-base text-bb-ink hover:bg-bb-honey/90"
        disabled={busy}
      >
        {busy ? "Saving…" : "Post daily log"}
      </Button>
    </form>
  );
}
