import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { deleteAccounts, deleteJobs } from "./support/cleanup";
import { adminClient } from "./support/users";

/**
 * Phase 5 photos (SPEC §8.5 #6, §2 PWA, §13.1): upload with category and
 * area, the required-shot checklist, before/after compare, share (simulated)
 * and zip download; GPS never reaches storage; and the PLAN "done when":
 * a photo taken while offline waits on the device and syncs after reconnect.
 */

const t = randomUUID().slice(0, 6);
const SCREENS = "docs/screens/phase-5";

test.describe.configure({ mode: "serial", timeout: 240_000 });

let orgId = "";
let accountId = "";
let jobId = "";

async function photo(color: string): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: color } })
    .withExif({
      IFD0: { Make: "PhoneCo" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "47/1 40/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "122/1 7/1 0/1",
      },
    })
    .jpeg()
    .toBuffer();
}

test.beforeAll(async () => {
  const db = adminClient();
  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  orgId = org!.id;
  const { data: acct, error: e1 } = await db
    .from("accounts")
    .insert({ org_id: orgId, display_name: `Photos${t} Residence` })
    .select("id")
    .single();
  if (e1) throw e1;
  accountId = acct!.id;
  const { data: contact } = await db
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: accountId,
      first_name: "Ivy",
      last_name: `Photos${t}`,
      email: `ivy-${t}@example.com`,
      email_opt_in: true,
    })
    .select("id")
    .single();
  const { data: job, error: e2 } = await db
    .from("jobs")
    .insert({
      org_id: orgId,
      name: `Photos${t} – Kirkland – Exterior`,
      account_id: accountId,
      primary_contact_id: contact!.id,
      work_types: ["exterior"],
    })
    .select("id")
    .single();
  if (e2) throw e2;
  jobId = job!.id;
});

test.afterAll(async () => {
  if (process.env.E2E_KEEP) return;
  await deleteJobs([jobId]);
  await deleteAccounts([accountId]);
});

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) =>
          `${v.id}: ${v.nodes
            .map((n) => n.target.join(" "))
            .slice(0, 3)
            .join(" | ")}`,
      ),
  ).toEqual([]);
}

const gallery = (page: Page) => page.getByRole("list", { name: "Photos" });

test("upload, checklist, compare, share and download", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-desktop", "Phone capture is tested below.");
  await page.goto(`/jobs/${jobId}?section=photos`);
  await expect(page.getByRole("heading", { name: "No photos yet" })).toBeVisible();
  await expect(page.getByTestId("sync-indicator")).toContainText("Offline ready");

  await page.getByLabel("New photos are").selectOption("before");
  await page.getByLabel("Area (optional)").fill("Front");
  await page
    .getByTestId("photo-upload-input")
    .setInputFiles([
      { name: "front-before.jpg", mimeType: "image/jpeg", buffer: await photo("#88aa88") },
    ]);
  await expect(gallery(page).getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("New photos are").selectOption("after");
  await page
    .getByTestId("photo-upload-input")
    .setInputFiles([
      { name: "front-after.jpg", mimeType: "image/jpeg", buffer: await photo("#2f6f4f") },
    ]);
  await expect(gallery(page).getByRole("listitem")).toHaveCount(2);

  // Stored copies carry no EXIF (no GPS), and say so.
  const db = adminClient();
  const { data: rows } = await db
    .from("job_photos")
    .select("storage_path, exif_stripped, category, area")
    .eq("job_id", jobId);
  expect(rows?.map((r: { category: string }) => r.category).sort()).toEqual(["after", "before"]);
  for (const r of rows ?? []) {
    expect(r.exif_stripped).toBe(true);
    const { data: file } = await db.storage.from("photos").download(r.storage_path);
    const meta = await sharp(Buffer.from(await file!.arrayBuffer())).metadata();
    expect(meta.exif).toBeUndefined();
  }

  // Filter chips count by category.
  const chips = page.getByRole("group", { name: "Filter by category" });
  await expect(chips.getByRole("button", { name: /^Before\s*1$/ })).toBeVisible();
  await chips.getByRole("button", { name: /^After/ }).click();
  await expect(gallery(page).getByRole("listitem")).toHaveCount(1);
  await chips.getByRole("button", { name: /^All/ }).click();

  // Checklist: the before and after shots are done.
  await page.getByRole("tab", { name: /Checklist/ }).click();
  const shots = page.getByRole("list", { name: "Required shots" });
  await expect(shots.getByRole("listitem").filter({ hasText: "Before" })).toContainText("1 photo");
  await expect(shots.getByRole("listitem").filter({ hasText: "Prep" })).toContainText("Washed");

  // Compare slider.
  await page.getByRole("tab", { name: "Before/After" }).click();
  await expect(page.getByRole("slider", { name: "Compare before and after" })).toBeVisible();
  await page.getByRole("slider", { name: "Compare before and after" }).fill("30");
  await page.screenshot({ path: `${SCREENS}/photos-compare.png`, fullPage: true });

  // Select all → share (simulated) → download zip.
  await page.getByRole("tab", { name: "Gallery" }).click();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByText("2 selected")).toBeVisible();
  const zipHref = await page.getByRole("link", { name: "Download" }).getAttribute("href");
  const zip = await page.request.get(zipHref!);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
  await page.getByRole("button", { name: "Share with customer" }).click();
  await expect(page.getByRole("dialog")).toContainText("Simulated – not sent");
  await page.getByRole("dialog").getByRole("button", { name: "Share" }).click();
  await expect(page.getByText(/Shared 2 photos \(simulated\)/)).toBeVisible();
  await expect(gallery(page).getByText("Shared")).toHaveCount(2);
  await page.screenshot({ path: `${SCREENS}/photos-gallery.png`, fullPage: true });
  await axe(page);
});

test("a photo taken offline waits on the device and syncs after reconnect", async ({
  page,
  context,
}) => {
  await page.goto(`/jobs/${jobId}?section=photos`);
  await expect(page.getByTestId("sync-indicator")).toContainText("Offline ready");
  const before = await gallery(page)
    .getByRole("listitem")
    .count()
    .catch(() => 0);
  const { count: dbBefore } = await adminClient()
    .from("job_photos")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);

  await context.setOffline(true);
  await expect(page.getByTestId("sync-indicator").first()).toContainText("Offline");
  await page.getByLabel("New photos are").selectOption("progress");
  await page
    .getByTestId("photo-camera-input")
    .setInputFiles([
      { name: "offline.jpg", mimeType: "image/jpeg", buffer: await photo("#aa8844") },
    ]);
  const waiting = page.getByRole("region", { name: "Waiting to upload" });
  await expect(waiting).toContainText("saved on this device");
  await expect(page.getByTestId("sync-indicator").first()).toContainText("1 waiting to upload");
  await page.screenshot({
    path: `${SCREENS}/photos-offline-${test.info().project.name === "e2e-mobile" ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
  // Nothing reached the server while offline.
  const { count: dbOffline } = await adminClient()
    .from("job_photos")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  expect(dbOffline).toBe(dbBefore);

  await context.setOffline(false);
  await expect(waiting).toBeHidden({ timeout: 30_000 });
  await expect(gallery(page).getByRole("listitem")).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(page.getByTestId("sync-indicator").first()).toContainText("Last synced");
  const { data: synced } = await adminClient()
    .from("job_photos")
    .select("source, category")
    .eq("job_id", jobId)
    .eq("source", "offline");
  expect(synced?.length).toBeGreaterThanOrEqual(1);
  expect(synced?.[0]?.category).toBe("progress");
});

test("on a phone: the Camera page takes a photo for a job", async ({ page }, info) => {
  test.skip(info.project.name !== "e2e-mobile", "Crew screen.");
  await page.goto(`/field/camera?job=${jobId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Camera" })).toBeVisible();
  await expect(page.getByLabel("Job")).toHaveValue(jobId);
  await page.getByLabel("Photo type").selectOption("cleanup");
  await page
    .getByTestId("camera-input")
    .setInputFiles([
      { name: "cleanup.jpg", mimeType: "image/jpeg", buffer: await photo("#dddddd") },
    ]);
  await expect
    .poll(
      async () => {
        const { data } = await adminClient()
          .from("job_photos")
          .select("source")
          .eq("job_id", jobId)
          .eq("category", "cleanup");
        return data?.[0]?.source ?? null;
      },
      { timeout: 30_000 },
    )
    .toBe("camera");
  await expect(page.getByText("All photos for this job are uploaded.")).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: `${SCREENS}/camera-mobile.png`, fullPage: true });
  await axe(page);
});
