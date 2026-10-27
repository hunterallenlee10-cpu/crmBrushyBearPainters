"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  Circle,
  CloudOff,
  Download,
  ImagePlus,
  Loader2,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { firstErrors, useRunAction } from "@/components/forms/use-run-action";
import { EmptyState } from "@/components/layout/empty-state";
import { useJobQueue } from "@/components/offline/offline-sync";
import { CompareSlider } from "@/components/photos/compare-slider";
import { usePhotoCapture } from "@/components/photos/use-photo-capture";
import {
  PHOTO_CATEGORIES,
  PHOTO_CATEGORY_LABELS,
  areaTags,
  categoryCounts,
  isPhotoCategory,
  shotCoverage,
  suggestPair,
  type ChecklistShot,
  type PhotoCategory,
} from "@/lib/domain/photos";
import { formatDateTime } from "@/lib/format/dates";
import { deletePhotos, sharePhotos, updatePhoto } from "./actions";

export type PhotoItem = {
  id: string;
  category: string;
  area: string | null;
  caption: string | null;
  checklistKey: string | null;
  thumbUrl: string | null;
  url: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  takenAt: string | null;
  uploadedByName: string | null;
  mine: boolean;
  shared: boolean;
};

type Can = { read: boolean; upload: boolean; delete: boolean; share: boolean; edit: boolean };

const label = (c: string) => (isPhotoCategory(c) ? PHOTO_CATEGORY_LABELS[c] : "Other");

/**
 * Job → Photos (SPEC §8.5 #6). Camera and Upload both go through the offline
 * queue, so a photo taken without signal shows as "waiting" and uploads when
 * the connection is back; the gallery refreshes when it lands.
 */
export function PhotosClient({
  jobId,
  photos,
  total,
  summary,
  shots,
  areaSuggestions,
  contactFirstName,
  can,
  limit,
}: {
  jobId: string;
  photos: PhotoItem[];
  total: number;
  summary: { total: number; today: number; thisWeek: number; shared: number };
  shots: ChecklistShot[];
  areaSuggestions: string[];
  contactFirstName: string | null;
  can: Can;
  limit: number;
}) {
  const router = useRouter();
  const queue = useJobQueue(jobId);
  const capture = usePhotoCapture(jobId);
  const [tab, setTab] = React.useState("gallery");
  const [filter, setFilter] = React.useState<PhotoCategory | "all">("all");
  const [area, setArea] = React.useState("");
  const [newCategory, setNewCategory] = React.useState<PhotoCategory>("progress");
  const [newArea, setNewArea] = React.useState("");
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState<PhotoItem | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const pendingShot = React.useRef<ChecklistShot | null>(null);

  // When this job's queued photos land, show them.
  React.useEffect(
    () => queue.onSynced((jobs) => jobs.includes(jobId) && router.refresh()),
    [queue, jobId, router],
  );

  const counts = categoryCounts(photos);
  const areas = areaTags(photos, areaSuggestions);
  const visible = photos.filter(
    (p) =>
      (filter === "all" || p.category === filter) &&
      (!area || (p.area ?? "").toLowerCase() === area.toLowerCase()),
  );
  const coverage = shotCoverage(shots, photos);
  const waiting = queue.jobItems.filter((i) => i.state !== "failed").length;

  const onFiles = async (files: FileList | null, source: "camera" | "upload") => {
    const shot = pendingShot.current;
    pendingShot.current = null;
    await capture.add(
      files,
      shot
        ? { category: shot.category, area: shot.area ?? undefined, checklistKey: shot.key }
        : { category: newCategory, area: newArea },
      source,
    );
    if (cameraRef.current) cameraRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
  };

  const takeFor = (shot: ChecklistShot) => {
    pendingShot.current = shot;
    cameraRef.current?.click();
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedIds = [...selected];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {can.upload && (
          <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="photo-new-category" label="New photos are">
                <NativeSelect
                  id="photo-new-category"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as PhotoCategory)}
                >
                  {PHOTO_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {PHOTO_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="photo-new-area" label="Area (optional)">
                <Input
                  id="photo-new-area"
                  list="photo-areas"
                  value={newArea}
                  onChange={(e) => setNewArea(e.target.value)}
                  placeholder="Kitchen, Front elevation…"
                  className="h-11 sm:h-9"
                />
              </Field>
            </div>
            <datalist id="photo-areas">
              {areas.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="cta"
                size="touch"
                onClick={() => cameraRef.current?.click()}
                disabled={!capture.ready || capture.busy}
              >
                <Camera aria-hidden /> Camera
              </Button>
              <Button
                type="button"
                variant="outline"
                size="touch"
                onClick={() => uploadRef.current?.click()}
                disabled={!capture.ready || capture.busy}
              >
                <ImagePlus aria-hidden /> Upload
              </Button>
              {capture.busy && (
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Preparing…
                </span>
              )}
            </div>
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              aria-label="Take photos with the camera"
              tabIndex={-1}
              data-testid="photo-camera-input"
              onChange={(e) => void onFiles(e.target.files, "camera")}
            />
            <input
              ref={uploadRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              className="sr-only"
              aria-label="Upload photos"
              tabIndex={-1}
              data-testid="photo-upload-input"
              onChange={(e) => void onFiles(e.target.files, "upload")}
            />
          </div>
        )}

        <QueueStrip jobId={jobId} />

        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList aria-label="Photos">
              <TabsTrigger value="gallery">Gallery</TabsTrigger>
              <TabsTrigger value="checklist">
                Checklist
                <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                  {coverage.filter((c) => c.done).length}/{coverage.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="compare">Before/After</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="gallery" className="flex flex-col gap-3">
            <div
              className="flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Filter by category"
            >
              {(["all", ...PHOTO_CATEGORIES] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={filter === c}
                  onClick={() => setFilter(c)}
                  className={
                    filter === c
                      ? "inline-flex h-9 items-center gap-1 rounded-full bg-bb-forest px-3 text-sm font-medium text-white"
                      : "inline-flex h-9 items-center gap-1 rounded-full border bg-card px-3 text-sm font-medium hover:bg-accent"
                  }
                >
                  {c === "all" ? "All" : PHOTO_CATEGORY_LABELS[c]}
                  <span className="tabular-nums opacity-80">{counts[c]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {areas.length > 0 && (
                <div className="w-48">
                  <Field id="photo-area-filter" label="Area">
                    <NativeSelect
                      id="photo-area-filter"
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                    >
                      <option value="">All areas</option>
                      {areas.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              )}
              {photos.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelecting((s) => !s);
                    setSelected(new Set());
                  }}
                >
                  {selecting ? "Done selecting" : "Select"}
                </Button>
              )}
              {selecting && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setSelected(
                        selected.size === visible.length
                          ? new Set()
                          : new Set(visible.map((p) => p.id)),
                      )
                    }
                  >
                    {selected.size === visible.length && visible.length > 0
                      ? "Clear"
                      : "Select all"}
                  </Button>
                  <span className="text-sm text-muted-foreground" aria-live="polite">
                    {selected.size} selected
                  </span>
                  {can.share && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!selected.size}
                      onClick={() => setSharing(true)}
                    >
                      <Send aria-hidden /> Share with customer
                    </Button>
                  )}
                  <Button asChild variant="outline" disabled={!selected.size}>
                    <a
                      href={
                        selected.size
                          ? `/jobs/${jobId}/photos/download?ids=${selectedIds.slice(0, 100).join(",")}`
                          : undefined
                      }
                      aria-disabled={!selected.size}
                      download
                    >
                      <Download aria-hidden /> Download
                    </a>
                  </Button>
                  {can.delete && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!selected.size}
                      onClick={() => setDeleting(true)}
                    >
                      <Trash2 aria-hidden /> Delete
                    </Button>
                  )}
                </>
              )}
            </div>

            {photos.length === 0 && queue.jobItems.length === 0 ? (
              <EmptyState icon={Camera} title="No photos yet">
                <p>
                  Take before photos of every room or elevation first. They protect you and show the
                  customer how far it&apos;s come.
                </p>
              </EmptyState>
            ) : visible.length === 0 ? (
              <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                No photos match this filter.
              </p>
            ) : (
              <ul
                className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
                aria-label="Photos"
              >
                {visible.map((p) => (
                  <li key={p.id} className="relative">
                    <button
                      type="button"
                      onClick={() => (selecting ? toggle(p.id) : setOpen(p))}
                      aria-pressed={selecting ? selected.has(p.id) : undefined}
                      aria-label={`${label(p.category)} photo${p.area ? `, ${p.area}` : ""}, ${formatDateTime(p.createdAt)}`}
                      className={`group block w-full overflow-hidden rounded-xl border bg-muted text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${selected.has(p.id) ? "ring-[3px] ring-bb-forest" : ""}`}
                    >
                      {p.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- signed private URL
                        <img
                          src={p.thumbUrl}
                          alt=""
                          loading="lazy"
                          className="aspect-square w-full object-cover"
                        />
                      ) : (
                        <span className="grid aspect-square place-items-center text-xs text-muted-foreground">
                          Unavailable
                        </span>
                      )}
                      <span className="flex items-center justify-between gap-1 bg-card px-2 py-1 text-xs">
                        <span className="truncate font-medium">
                          {label(p.category)}
                          {p.area ? ` · ${p.area}` : ""}
                        </span>
                        {p.shared && <span className="shrink-0 text-success">Shared</span>}
                      </span>
                      {selecting && (
                        <span className="absolute top-2 left-2 rounded-full bg-white/90">
                          {selected.has(p.id) ? (
                            <CheckCircle2 className="size-6 text-bb-forest" aria-hidden />
                          ) : (
                            <Circle className="size-6 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {total > photos.length && (
              <Link
                href={`/jobs/${jobId}?section=photos&limit=${limit + 120}`}
                className="text-sm font-semibold text-bb-forest underline"
                scroll={false}
              >
                Show more ({total - photos.length} older)
              </Link>
            )}
          </TabsContent>

          <TabsContent value="checklist">
            {coverage.length === 0 ? (
              <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                This job&apos;s work types have no required shots.
              </p>
            ) : (
              <ul className="divide-y rounded-2xl border bg-card" aria-label="Required shots">
                {coverage.map((c) => {
                  const first = photos.find((p) => c.photoIds.includes(p.id));
                  return (
                    <li key={c.key} className="flex min-h-14 items-center gap-3 px-4 py-2">
                      {c.done ? (
                        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                      ) : (
                        <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">{c.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.done
                            ? `${c.photoIds.length} photo${c.photoIds.length === 1 ? "" : "s"}`
                            : c.hint}
                        </span>
                      </span>
                      {first?.thumbUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- signed private URL
                        <img
                          src={first.thumbUrl}
                          alt=""
                          className="size-10 rounded-md object-cover"
                        />
                      )}
                      {can.upload && (
                        <Button
                          type="button"
                          size="sm"
                          variant={c.done ? "ghost" : "outline"}
                          onClick={() => takeFor(c)}
                          aria-label={`Take photo: ${c.label}`}
                        >
                          <Camera aria-hidden /> {c.done ? "Add" : "Take"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="compare">
            <Compare photos={photos} />
          </TabsContent>
        </Tabs>
      </div>

      <aside
        className="grid grid-cols-2 gap-2 rounded-2xl border bg-card p-4 text-sm sm:grid-cols-5 lg:w-56 lg:grid-cols-1"
        aria-label="Photo summary"
      >
        <Stat label="Total" value={summary.total} />
        <Stat label="Today" value={summary.today} />
        <Stat label="This week" value={summary.thisWeek} />
        <Stat label="Waiting to upload" value={waiting} />
        <Stat label="Shared with customer" value={summary.shared} />
      </aside>

      {open && (
        <PhotoDialog
          jobId={jobId}
          photo={open}
          areas={areas}
          canEdit={can.upload && (open.mine || can.edit)}
          canDelete={can.delete}
          onClose={() => setOpen(null)}
        />
      )}
      {sharing && (
        <ShareDialog
          jobId={jobId}
          ids={selectedIds}
          firstName={contactFirstName}
          onClose={(done) => {
            setSharing(false);
            if (done) {
              setSelecting(false);
              setSelected(new Set());
            }
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          jobId={jobId}
          ids={selectedIds}
          onClose={(done) => {
            setDeleting(false);
            if (done) {
              setSelecting(false);
              setSelected(new Set());
            }
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** Photos on this device waiting to upload (or refused), with retry/discard. */
function QueueStrip({ jobId }: { jobId: string }) {
  const q = useJobQueue(jobId);
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    const next: Record<string, string> = {};
    for (const i of q.jobItems) if (i.blob) next[i.id] = URL.createObjectURL(i.blob);
    setUrls(next);
    return () => {
      for (const u of Object.values(next)) URL.revokeObjectURL(u);
    };
  }, [q.jobItems]);
  if (!q.jobItems.length) return null;
  return (
    <section
      aria-label="Waiting to upload"
      className="flex flex-col gap-2 rounded-2xl border border-warning/40 bg-warning-bg/40 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <CloudOff className="size-4" aria-hidden />
        {q.online
          ? `${q.jobItems.length} photo${q.jobItems.length === 1 ? "" : "s"} uploading from this device`
          : `${q.jobItems.length} photo${q.jobItems.length === 1 ? "" : "s"} saved on this device. They upload when you're back online.`}
      </p>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {q.jobItems.map((i) => (
          <li key={i.id} className="flex w-28 shrink-0 flex-col gap-1">
            {urls[i.id] ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview
              <img
                src={urls[i.id]}
                alt=""
                className="aspect-square w-full rounded-lg object-cover"
              />
            ) : (
              <span className="aspect-square w-full rounded-lg bg-muted" />
            )}
            <span className="text-xs" data-testid="queue-item-state">
              {i.state === "failed"
                ? `Not uploaded: ${i.lastError ?? "refused"}`
                : i.state === "uploading"
                  ? "Uploading…"
                  : "Waiting"}
            </span>
            {i.state === "failed" && (
              <span className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => void q.retry(i.id)}
                  aria-label="Retry upload"
                >
                  <RotateCcw aria-hidden />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => void q.discard(i.id)}
                  aria-label="Discard photo"
                >
                  <X aria-hidden />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Compare({ photos }: { photos: PhotoItem[] }) {
  const befores = photos.filter((p) => p.category === "before" && p.url);
  const afters = photos.filter((p) => p.category === "after" && p.url);
  const pair = suggestPair(photos.filter((p) => p.url));
  const [beforeId, setBeforeId] = React.useState(pair?.before.id ?? "");
  const [afterId, setAfterId] = React.useState(pair?.after.id ?? "");
  const before = befores.find((p) => p.id === beforeId) ?? befores[0];
  const after = afters.find((p) => p.id === afterId) ?? afters[0];
  if (!before || !after) {
    return (
      <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
        Take at least one Before and one After photo (same angle works best) to compare them here.
      </p>
    );
  }
  const name = (p: PhotoItem) => `${p.area ?? label(p.category)} · ${formatDateTime(p.createdAt)}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="compare-before" label="Before photo">
          <NativeSelect
            id="compare-before"
            value={before.id}
            onChange={(e) => setBeforeId(e.target.value)}
          >
            {befores.map((p) => (
              <option key={p.id} value={p.id}>
                {name(p)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="compare-after" label="After photo">
          <NativeSelect
            id="compare-after"
            value={after.id}
            onChange={(e) => setAfterId(e.target.value)}
          >
            {afters.map((p) => (
              <option key={p.id} value={p.id}>
                {name(p)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <CompareSlider beforeUrl={before.url as string} afterUrl={after.url as string} />
    </div>
  );
}

function PhotoDialog({
  jobId,
  photo,
  areas,
  canEdit,
  canDelete,
  onClose,
}: {
  jobId: string;
  photo: PhotoItem;
  areas: string[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
}) {
  const { pending, run } = useRunAction();
  const [category, setCategory] = React.useState<PhotoCategory>(
    isPhotoCategory(photo.category) ? photo.category : "other",
  );
  const [area, setArea] = React.useState(photo.area ?? "");
  const [caption, setCaption] = React.useState(photo.caption ?? "");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {label(photo.category)}
            {photo.area ? ` · ${photo.area}` : ""}
          </DialogTitle>
          <DialogDescription>
            {formatDateTime(photo.createdAt)}
            {photo.uploadedByName ? ` · ${photo.uploadedByName}` : ""}
            {photo.shared ? " · Shared with the customer" : ""}
          </DialogDescription>
        </DialogHeader>
        {photo.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed private URL
          <img
            src={photo.url}
            alt={`${label(photo.category)} photo${photo.area ? ` of ${photo.area}` : ""}`}
            className="max-h-[55dvh] w-full rounded-xl bg-muted object-contain"
          />
        ) : (
          <p className="text-sm text-muted-foreground">The file isn&apos;t available right now.</p>
        )}
        {canEdit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="photo-edit-category" label="Category">
              <NativeSelect
                id="photo-edit-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as PhotoCategory)}
              >
                {PHOTO_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {PHOTO_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="photo-edit-area" label="Area">
              <Input
                id="photo-edit-area"
                list="photo-edit-areas"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className="h-11 sm:h-9"
              />
              <datalist id="photo-edit-areas">
                {areas.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </Field>
            <Field id="photo-edit-caption" label="Caption" className="sm:col-span-2">
              <Textarea
                id="photo-edit-caption"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={2}
                maxLength={500}
              />
            </Field>
          </div>
        )}
        {confirmDelete && (
          <Field id="photo-delete-reason" label="Why delete it?" error={errors.reason}>
            <Input
              id="photo-delete-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Blurry, duplicate, wrong job…"
            />
          </Field>
        )}
        <DialogFooter className="gap-2">
          {canDelete &&
            (confirmDelete ? (
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  run(() => deletePhotos({ jobId, photoIds: [photo.id], reason }), {
                    success: "Photo deleted.",
                    onOk: onClose,
                    onError: (e) => setErrors(firstErrors(e)),
                  })
                }
              >
                Delete photo
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden /> Delete
              </Button>
            ))}
          {photo.url && (
            <Button asChild variant="outline">
              <a href={`/jobs/${jobId}/photos/download?ids=${photo.id}`} download>
                <Download aria-hidden /> Download
              </a>
            </Button>
          )}
          {canEdit && (
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() => updatePhoto({ jobId, photoId: photo.id, category, area, caption }), {
                  success: "Photo saved.",
                  onOk: onClose,
                })
              }
            >
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({
  jobId,
  ids,
  firstName,
  onClose,
}: {
  jobId: string;
  ids: string[];
  firstName: string | null;
  onClose: (done: boolean) => void;
}) {
  const { pending, run } = useRunAction();
  const n = ids.length;
  const hi = firstName ? `Hi ${firstName}` : "Hi";
  const [channel, setChannel] = React.useState<"email" | "sms">("email");
  const [subject, setSubject] = React.useState("Photos from your project");
  const [body, setBody] = React.useState(
    `${hi}, here ${n === 1 ? "is a photo" : `are ${n} photos`} from your project. Let us know if you have any questions.`,
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {n === 1 ? "1 photo" : `${n} photos`} with the customer</DialogTitle>
          <DialogDescription>
            Simulated – not sent. Messages go to the outbox until texting and email are connected.
            Draft wording – owner to approve.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field id="share-channel" label="Send by">
            <NativeSelect
              id="share-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as "email" | "sms")}
            >
              <option value="email">Email</option>
              <option value="sms">Text</option>
            </NativeSelect>
          </Field>
          {channel === "email" && (
            <Field id="share-subject" label="Subject" error={errors.subject}>
              <Input
                id="share-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </Field>
          )}
          <Field id="share-body" label="Message" error={errors.body}>
            <Textarea
              id="share-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="cta"
            disabled={pending}
            onClick={() =>
              run(() => sharePhotos({ jobId, photoIds: ids, channel, subject, body }), {
                success: (d) => `Shared ${d.shared} photo${d.shared === 1 ? "" : "s"} (simulated).`,
                onOk: () => onClose(true),
                onError: (e) => setErrors(firstErrors(e)),
              })
            }
          >
            <Send aria-hidden /> Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  jobId,
  ids,
  onClose,
}: {
  jobId: string;
  ids: string[];
  onClose: (done: boolean) => void;
}) {
  const { pending, run } = useRunAction();
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {ids.length === 1 ? "1 photo" : `${ids.length} photos`}?</DialogTitle>
          <DialogDescription>
            Deleted photos can be restored by an owner from Admin → Deleted Records.
          </DialogDescription>
        </DialogHeader>
        <Field id="photos-delete-reason" label="Why?" error={errors.reason}>
          <Input
            id="photos-delete-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onClose(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(() => deletePhotos({ jobId, photoIds: ids, reason }), {
                success: (d) => `Deleted ${d.deleted} photo${d.deleted === 1 ? "" : "s"}.`,
                onOk: () => onClose(true),
                onError: (e) => setErrors(firstErrors(e)),
              })
            }
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
