import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
const { processPhoto, UnreadablePhotoError } = await import("./process");

async function photoWithGps(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#7a9e7e" } })
    .withExif({
      IFD0: { Make: "PhoneCo", Model: "Camera 1" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "47/1 40/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "122/1 12/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

describe("processPhoto", () => {
  it("drops every EXIF field, including GPS, from the stored copy and thumbnail", async () => {
    const input = await photoWithGps(800, 600);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await processPhoto(input);
    const display = await sharp(out.display).metadata();
    const thumb = await sharp(out.thumb).metadata();
    expect(display.exif).toBeUndefined();
    expect(thumb.exif).toBeUndefined();
    expect(display.format).toBe("jpeg");
    expect(out.mime).toBe("image/jpeg");
    expect([out.width, out.height]).toEqual([800, 600]);
    expect(thumb.width).toBe(480);
  });

  it("shrinks large photos to the stored size", async () => {
    const big = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const out = await processPhoto(big);
    expect([out.width, out.height]).toEqual([2560, 1920]);
  });

  it("refuses files that aren't images", async () => {
    await expect(processPhoto(Buffer.from("not an image"))).rejects.toBeInstanceOf(
      UnreadablePhotoError,
    );
  });
});
