import "server-only";
import sharp, { type OutputInfo } from "sharp";
import { PHOTO_MAX_EDGE, THUMB_MAX_EDGE } from "@/lib/domain/photos";

/**
 * Re-encodes an uploaded photo on the server (SPEC §13.1): turns it upright
 * from its EXIF orientation, shrinks it to the stored size and a thumbnail,
 * and writes JPEGs without any metadata, so GPS location and camera details
 * never reach storage or a customer. The original file is not kept.
 */

export type ProcessedPhoto = {
  display: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  mime: "image/jpeg";
};

export class UnreadablePhotoError extends Error {}

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let display: { data: Buffer; info: OutputInfo };
  try {
    display = await sharp(input, { failOn: "error", limitInputPixels: 80_000_000 })
      .rotate()
      .resize({
        width: PHOTO_MAX_EDGE,
        height: PHOTO_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch (e) {
    throw new UnreadablePhotoError(e instanceof Error ? e.message : "unreadable image");
  }
  const thumb = await sharp(display.data)
    .resize({
      width: THUMB_MAX_EDGE,
      height: THUMB_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 72 })
    .toBuffer();
  return {
    display: display.data,
    thumb,
    width: display.info.width,
    height: display.info.height,
    mime: "image/jpeg",
  };
}
