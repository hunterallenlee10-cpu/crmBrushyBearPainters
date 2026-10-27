"use client";

import * as React from "react";
import { toast } from "sonner";
import { useOfflineSync } from "@/components/offline/offline-sync";
import {
  PHOTO_MAX_EDGE,
  PHOTO_UPLOAD_LIMIT,
  PHOTO_UPLOAD_TYPES,
  fitWithin,
  type PhotoCategory,
} from "@/lib/domain/photos";

/**
 * Turns picked or captured files into queued uploads (SPEC §8.5 #6, §2 PWA).
 * Each photo is shrunk in the browser first (smaller uploads on a weak
 * signal; re-encoding also drops EXIF), then waits in the IndexedDB queue and
 * uploads as soon as there's a connection. The server re-encodes again.
 */

export type CaptureDetails = {
  category: PhotoCategory;
  area?: string;
  caption?: string;
  checklistKey?: string;
};

async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = fitWithin(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (blob) return blob;
  } catch {
    // Fall through: send the original if the server can read it.
  }
  if ((PHOTO_UPLOAD_TYPES as readonly string[]).includes(file.type)) return file;
  throw new Error(
    "This photo format can't be read here. Take it with the camera or export it as JPEG.",
  );
}

export function usePhotoCapture(jobId: string) {
  const sync = useOfflineSync();
  const [busy, setBusy] = React.useState(false);

  const add = React.useCallback(
    async (
      files: FileList | File[] | null,
      details: CaptureDetails,
      source: "camera" | "upload",
    ) => {
      const list = files ? Array.from(files) : [];
      if (!list.length) return 0;
      if (!sync.ready) {
        toast.error("The photo queue is still starting. Try again in a moment.");
        return 0;
      }
      setBusy(true);
      let queued = 0;
      try {
        for (const file of list) {
          if (!file.type.startsWith("image/")) {
            toast.error(`${file.name} isn't a photo.`);
            continue;
          }
          let blob: Blob;
          try {
            blob = await shrink(file);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "That photo can't be read.");
            continue;
          }
          if (blob.size > PHOTO_UPLOAD_LIMIT) {
            toast.error(`${file.name} is too large (8 MB max).`);
            continue;
          }
          await sync.enqueue({
            id: crypto.randomUUID(),
            kind: "photo",
            jobId,
            blob,
            meta: {
              fileName: file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg",
              category: details.category,
              area: details.area?.trim() || null,
              caption: details.caption?.trim() || null,
              checklistKey: details.checklistKey ?? null,
              takenAt: new Date(file.lastModified || Date.now()).toISOString(),
              source: navigator.onLine ? source : "offline",
            },
          });
          queued++;
        }
      } finally {
        setBusy(false);
      }
      if (queued) {
        toast.success(
          navigator.onLine
            ? `${queued} photo${queued === 1 ? "" : "s"} uploading…`
            : `${queued} photo${queued === 1 ? "" : "s"} saved on this device. They'll upload when you're back online.`,
        );
      }
      return queued;
    },
    [jobId, sync],
  );

  return { add, busy, ready: sync.ready, online: sync.online };
}
