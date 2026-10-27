"use client";

import * as React from "react";
import Link from "next/link";
import { Camera, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { NativeSelect } from "@/components/forms/native-select";
import { useJobQueue } from "@/components/offline/offline-sync";
import { usePhotoCapture } from "@/components/photos/use-photo-capture";
import { PHOTO_CATEGORIES, PHOTO_CATEGORY_LABELS, type PhotoCategory } from "@/lib/domain/photos";

/** One-handed capture: job, category, area, then a big camera button. */
export function CameraClient({
  jobs,
  initialJobId,
  readOnly,
}: {
  jobs: { id: string; label: string; city: string | null }[];
  initialJobId: string | null;
  readOnly: boolean;
}) {
  const [jobId, setJobId] = React.useState(initialJobId ?? "");
  const [category, setCategory] = React.useState<PhotoCategory>("progress");
  const [area, setArea] = React.useState("");
  const capture = usePhotoCapture(jobId);
  const queue = useJobQueue(jobId);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const waiting = queue.jobItems.filter((i) => i.state !== "failed").length;
  const failed = queue.jobItems.filter((i) => i.state === "failed");

  const onFiles = async (files: FileList | null, source: "camera" | "upload") => {
    await capture.add(files, { category, area }, source);
    if (cameraRef.current) cameraRef.current.value = "";
    if (uploadRef.current) uploadRef.current.value = "";
  };

  return (
    <div className="flex flex-col gap-4">
      <Field id="camera-job" label="Job">
        <NativeSelect id="camera-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
              {j.city ? ` (${j.city})` : ""}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="camera-category" label="Photo type">
          <NativeSelect
            id="camera-category"
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
        <Field id="camera-area" label="Area">
          <Input
            id="camera-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Kitchen…"
            className="h-11"
          />
        </Field>
      </div>
      <Button
        type="button"
        variant="cta"
        className="h-20 text-lg"
        disabled={readOnly || !jobId || !capture.ready || capture.busy}
        onClick={() => cameraRef.current?.click()}
      >
        <Camera className="size-6" aria-hidden /> Take photo
      </Button>
      <Button
        type="button"
        variant="outline"
        size="touch"
        disabled={readOnly || !jobId || !capture.ready || capture.busy}
        onClick={() => uploadRef.current?.click()}
      >
        <ImagePlus aria-hidden /> Choose from library
      </Button>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Take photos with the camera"
        data-testid="camera-input"
        onChange={(e) => void onFiles(e.target.files, "camera")}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose photos"
        onChange={(e) => void onFiles(e.target.files, "upload")}
      />
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {waiting
          ? `${waiting} photo${waiting === 1 ? "" : "s"} for this job ${queue.online ? "uploading…" : "waiting for a connection."}`
          : "All photos for this job are uploaded."}
        {failed.length > 0 && ` ${failed.length} couldn't upload; open the job's Photos to retry.`}
      </p>
      {jobId && (
        <Link
          href={`/jobs/${jobId}?section=photos`}
          className="text-sm font-semibold text-bb-forest underline"
        >
          Open this job&apos;s photos
        </Link>
      )}
    </div>
  );
}
