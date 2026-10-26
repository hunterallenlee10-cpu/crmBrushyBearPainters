import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, loginAs, TEST_USERS, type TestRole } from "./support/users";

/**
 * New Lead wizard (SPEC §8.4): three steps, Completion %, live duplicate check,
 * owner rules, photo upload, and the phase-report screenshots. Every lead a
 * test creates (or seeds) is hard-deleted afterwards.
 */

const OUT = join(process.cwd(), "docs", "screens", "phase-2");
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const LEAD_URL = /\/leads\/([0-9a-f-]{36})(\?book=1)?$/;
/** Smallest valid JPEG (1×1). */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

const uniq = () => randomUUID().slice(0, 8);
/** A fake 425-555-01xx number (reserved for fiction) as typed, and as stored. */
function fakePhone() {
  const xx = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return { typed: `(425) 555-01${xx}`, e164: `+142555501${xx}` };
}

const created = new Set<string>();

async function cleanup(ids: Iterable<string>) {
  const list = [...ids];
  if (list.length === 0) return;
  const db = adminClient();
  const { data: files } = await db
    .from("lead_attachments")
    .select("storage_path")
    .in("lead_id", list);
  const paths = (files ?? []).map((f: { storage_path: string }) => f.storage_path);
  if (paths.length) await db.storage.from("lead-attachments").remove(paths);
  await db.from("lead_attachments").delete().in("lead_id", list);
  await db.from("intake_requests").delete().in("lead_id", list);
  await db.from("notes").delete().eq("subject_type", "lead").in("subject_id", list);
  await db.from("activity").delete().eq("subject_type", "lead").in("subject_id", list);
  const { error } = await db.from("leads").delete().in("id", list);
  if (error) throw error;
}

test.afterAll(async () => {
  await cleanup(created);
});

async function orgId(): Promise<string> {
  const { data, error } = await adminClient()
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  if (error || !data) throw error ?? new Error("org missing");
  return (data as { id: string }).id;
}

async function userId(role: TestRole): Promise<string> {
  const { data, error } = await adminClient()
    .from("profiles")
    .select("id")
    .eq("email", TEST_USERS[role].email)
    .single();
  if (error || !data) throw error ?? new Error(`profile for ${role} missing`);
  return (data as { id: string }).id;
}

/** A lead created behind the scenes (service role), for duplicate checks. */
async function seedLead(fields: { mobile: string; lastName: string; ownerRole: TestRole }) {
  const { data, error } = await adminClient()
    .from("leads")
    .insert({
      org_id: await orgId(),
      first_name: "Dupe",
      last_name: fields.lastName,
      mobile: fields.mobile,
      lead_source: "other",
      owner_id: await userId(fields.ownerRole),
      intake_channel: "manual",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("seed failed");
  const id = (data as { id: string }).id;
  created.add(id);
  return id;
}

/** `loginAs` with retries: other specs may sign in as the same shared user at once. */
async function signIn(page: Page, role: TestRole, next: string) {
  const authScreen = (url: URL) => ["/login", "/mfa", "/auth/confirm"].includes(url.pathname);
  for (let attempt = 1; ; attempt++) {
    try {
      await loginAs(page, role, next);
    } catch (error) {
      if (attempt >= 4) throw error;
    }
    const ok = await page
      .waitForURL((url) => !authScreen(url), { timeout: 15_000, waitUntil: "commit" })
      .then(
        () => true,
        () => false,
      );
    if (ok) return;
    if (attempt >= 4) throw new Error(`Could not sign in as ${role}: ended on ${page.url()}`);
    const onMfa = new URL(page.url()).pathname === "/mfa";
    await page.waitForTimeout(
      onMfa ? 30_500 - (Date.now() % 30_000) : 1_000 + Math.random() * 3_000,
    );
  }
}

async function shot(page: Page, name: string, fullPage = true) {
  mkdirSync(OUT, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Start at the top so the sticky top bar isn't captured mid-page.
    window.scrollTo(0, 0);
  });
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage, animations: "disabled" });
}

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });
const next = (page: Page) => page.getByRole("button", { name: "Next" });

async function openWizard(page: Page) {
  await page.goto("/leads/new");
  await expect(page.getByRole("heading", { level: 1, name: "New Lead" })).toBeVisible();
  // Wait for hydration so typed input reaches React state.
  await page.waitForLoadState("networkidle");
}

async function fillStep1(page: Page, last: string, phone: string) {
  await page.getByLabel("First name").fill("Wanda");
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Mobile").fill(phone);
  await page.getByLabel("Email").fill(`wanda-${last.toLowerCase()}@example.com`);
}

async function savedLeadId(page: Page): Promise<string> {
  await page.waitForURL(LEAD_URL, { timeout: 30_000 });
  const id = LEAD_URL.exec(new URL(page.url()).pathname + new URL(page.url()).search)?.[1];
  if (!id) throw new Error(`no lead id in ${page.url()}`);
  created.add(id);
  return id;
}

test.describe("New Lead wizard", () => {
  test.skip(({ isMobile }) => isMobile, "desktop flows; the mobile layout is checked below");
  test.describe.configure({ timeout: 150_000 });
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("owner creates a lead through all three steps and books a walkthrough", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openWizard(page);
    const last = `Wizard${uniq()}`;
    const phone = fakePhone();
    const percent = page.getByTestId("completion-percent");
    await expect(percent).toHaveText("0%");
    await expect(page.locator('[aria-current="step"]')).toContainText("Info");

    await fillStep1(page, last, phone.typed);
    await expect(percent).not.toHaveText("0%");
    await page.getByLabel("Company").focus();
    await shot(page, "leads-new-step1");
    await next(page).click();

    // Focus moves to the new step's heading.
    await expect(heading(page, "The property")).toBeFocused();
    await page.getByLabel("Street").fill("123 Test Ave");
    await page.getByLabel("City").fill("Kirkland");
    await expect(page.getByLabel("State")).toHaveValue("WA");
    await page.getByLabel("ZIP").fill("98033");
    await expect(page.getByTestId("territory-note")).toHaveText("Territory: Kirkland");
    await expect(page.getByTestId("lead-safe-note")).toHaveCount(0);
    await page.getByLabel("Year built").fill("1962");
    await expect(page.getByRole("radio", { name: "Before 1978" })).toBeChecked();
    await expect(page.getByTestId("lead-safe-note")).toContainText("Lead-safe prep applies");
    await page.getByLabel("Property type").selectOption({ label: "Single-family" });
    await page.getByLabel("Siding type").selectOption({ label: "Cedar/Wood" });
    await page.getByRole("group", { name: "Stories" }).getByText("2", { exact: true }).click();
    await page.getByRole("group", { name: "HOA" }).getByText("No", { exact: true }).click();
    await shot(page, "leads-new-step2");
    await next(page).click();

    await expect(heading(page, "What they need")).toBeFocused();
    await page.getByLabel("Exterior").check();
    await page.getByLabel("Timeline").selectOption("asap");
    await page.getByLabel(/^Source/).selectOption({ label: "Website" });
    await page.getByLabel("Sub-source").selectOption({ label: "Organic" });
    await expect(page.getByLabel("Lead set by")).toHaveValue(await userId("owner"));
    await expect(page.getByLabel("Owner")).toHaveValue(await userId("owner"));
    await page.getByLabel("Notes").fill("Peeling paint on the south side. Fake test lead.");
    await expect(page.getByRole("button", { name: "Call" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByRole("button", { name: "Save & Convert" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await shot(page, "leads-new-step3");

    await page.getByRole("button", { name: "Save & book walkthrough" }).click();
    const id = await savedLeadId(page);
    expect(page.url()).toContain(`/leads/${id}?book=1`);

    const ownerId = await userId("owner");
    const { data: lead } = await adminClient()
      .from("leads")
      .select(
        "first_name, last_name, mobile, email, street, city, state, zip, out_of_area, year_built, home_built, property_type, stories, siding_type, has_hoa, services, timeline, lead_source, lead_sub_source, intake_channel, owner_id, lead_set_by, status, score, grade, scored_at, territory:territories(name)",
      )
      .eq("id", id)
      .single();
    expect(lead).toMatchObject({
      first_name: "Wanda",
      last_name: last,
      mobile: phone.e164,
      email: `wanda-${last.toLowerCase()}@example.com`,
      street: "123 Test Ave",
      city: "Kirkland",
      state: "WA",
      zip: "98033",
      out_of_area: false,
      year_built: 1962,
      home_built: "before_1978",
      property_type: "single_family",
      stories: 2,
      siding_type: "cedar_wood",
      has_hoa: false,
      services: ["exterior"],
      timeline: "asap",
      lead_source: "website",
      lead_sub_source: "organic",
      intake_channel: "manual",
      owner_id: ownerId,
      lead_set_by: ownerId,
      status: "new",
      territory: { name: "Kirkland" },
    });
    expect(lead?.score).toEqual(expect.any(Number));
    expect(lead?.grade).toMatch(/^[A-F]$/);
    expect(lead?.scored_at).not.toBeNull();
  });

  test("shows clear validation errors on each step", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openWizard(page);
    await next(page).click();
    await expect(page.getByText("First name is required.")).toBeVisible();
    await page.getByLabel("First name").fill("Vic");
    await page.getByLabel("Last name").fill(`Valid${uniq()}`);
    await next(page).click();
    const contact = page.getByText("Add a mobile, phone or email so we can reach them.");
    await expect(contact).toBeVisible();
    const mobile = page.getByLabel("Mobile");
    await expect(mobile).toHaveAttribute("aria-invalid", "true");
    await expect(mobile).toHaveAttribute("aria-describedby", "mobile-error");

    await page.getByLabel("Email").fill("not-an-email");
    await next(page).click();
    await expect(page.getByText("That email doesn't look right.")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-describedby", "email-error");
    await expect(contact).toHaveCount(0);
    await expect(heading(page, "Who is it?")).toBeVisible();

    await page.getByLabel("Email").fill(`vic-${uniq()}@example.com`);
    await next(page).click();
    await page.getByLabel("ZIP").fill("123");
    await next(page).click();
    await expect(page.getByText("Enter a 5-digit ZIP code.")).toBeVisible();
    await page.getByLabel("ZIP").fill("99999");
    await expect(page.getByTestId("territory-note")).toContainText("Out of area");
    await next(page).click();

    await page.getByRole("button", { name: "Save lead" }).click();
    await expect(page.getByText("Source is required.")).toBeVisible();
    await page.getByLabel(/^Source/).selectOption({ label: "Website" });
    await page.getByRole("button", { name: "Save lead" }).click();
    await expect(page.getByText("Pick a sub-source.")).toBeVisible();
    await expect(page).toHaveURL(/\/leads\/new$/);

    // Previous keeps what was typed.
    await page.getByRole("button", { name: "Previous" }).click();
    await page.getByRole("button", { name: "Previous" }).click();
    await expect(page.getByLabel("First name")).toHaveValue("Vic");
  });

  test("warns about a possible duplicate when the phone matches", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const phone = fakePhone();
    const last = `Match${uniq()}`;
    const existing = await seedLead({ mobile: phone.e164, lastName: last, ownerRole: "owner" });
    await openWizard(page);
    await page.getByLabel("First name").fill("Wanda");
    await page.getByLabel("Last name").fill(`Other${uniq()}`);
    await page.getByLabel("Mobile").fill(phone.typed.replace(/\D/g, ""));
    const banner = page.getByTestId("duplicate-banner");
    await expect(banner).toContainText(
      `Possible duplicate: Dupe ${last} · New · owned by Olive Owner`,
    );
    await expect(banner).toContainText("(Same phone number)");
    await expect(banner.getByRole("link", { name: "Open existing" })).toHaveAttribute(
      "href",
      `/leads/${existing}`,
    );
    // Non-blocking: the wizard still moves on.
    await page.getByLabel("Mobile").fill(fakePhone().typed.replace("(425) 555", "(206) 555"));
    await next(page).click();
    await expect(heading(page, "The property")).toBeVisible();
  });

  test("estimator can't pick another owner and sees only a notice for others' duplicates", async ({
    page,
  }) => {
    await page.setViewportSize(DESKTOP);
    const phone = fakePhone();
    const last = `Hidden${uniq()}`;
    await seedLead({ mobile: phone.e164, lastName: last, ownerRole: "owner" });
    await signIn(page, "estimator", "/leads/new");
    await openWizard(page);
    await page.getByLabel("First name").fill("Eddie");
    await page.getByLabel("Last name").fill(`Est${uniq()}`);
    await page.getByLabel("Mobile").fill(phone.typed);
    const banner = page.getByTestId("duplicate-banner");
    await expect(banner).toContainText(
      `Possible duplicate: Dupe ${last} · New · owned by Olive Owner`,
    );
    await expect(banner).toContainText("It's owned by someone else, so you can't open it.");
    await expect(banner.getByRole("link")).toHaveCount(0);

    await page.getByLabel("Mobile").fill("");
    await page.getByLabel("Email").fill(`eddie-${uniq()}@example.com`);
    await next(page).click();
    await next(page).click();
    const owner = page.getByLabel("Owner");
    await expect(owner).toHaveValue(`${TEST_USERS.estimator.fullName} (you)`);
    await expect(owner).not.toBeEditable();
    await expect(page.getByRole("combobox", { name: "Owner" })).toHaveCount(0);

    await page.getByLabel(/^Source/).selectOption({ label: "Yard Sign" });
    await page.getByRole("button", { name: "Save lead" }).click();
    const id = await savedLeadId(page);
    const { data: lead } = await adminClient()
      .from("leads")
      .select("owner_id, lead_set_by, lead_source")
      .eq("id", id)
      .single();
    const estimatorId = await userId("estimator");
    expect(lead).toMatchObject({
      owner_id: estimatorId,
      lead_set_by: estimatorId,
      lead_source: "yard_sign",
    });
  });

  test("painter gets 404 on /leads/new", async ({ page }) => {
    await signIn(page, "painter", "/");
    const res = await page.goto("/leads/new");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("uploads a photo after saving and counts it in the score", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openWizard(page);
    await fillStep1(page, `Photo${uniq()}`, fakePhone().typed);
    await next(page).click();
    await page.getByLabel("ZIP").fill("98033");
    await next(page).click();
    await page.getByLabel(/^Source/).selectOption({ label: "Nextdoor" });
    await page.getByLabel("Add photos").setInputFiles({
      name: "porch.jpg",
      mimeType: "image/jpeg",
      buffer: TINY_JPEG,
    });
    await expect(page.getByText("porch.jpg")).toBeVisible();
    await page.getByLabel("Add photos").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello"),
    });
    await expect(
      page.getByText("notes.txt: only photos (JPG, PNG, WebP, HEIC) or PDFs."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Save lead" }).click();
    const id = await savedLeadId(page);
    expect(new URL(page.url()).search).toBe("");

    const db = adminClient();
    const org = await orgId();
    await expect
      .poll(
        async () =>
          (
            await db
              .from("lead_attachments")
              .select("id", { count: "exact", head: true })
              .eq("lead_id", id)
          ).count,
        { timeout: 20_000 },
      )
      .toBe(1);
    const { data: rows } = await db
      .from("lead_attachments")
      .select("org_id, file_name, content_type, size_bytes, source, storage_path")
      .eq("lead_id", id);
    expect(rows?.[0]).toMatchObject({
      org_id: org,
      file_name: "porch.jpg",
      content_type: "image/jpeg",
      size_bytes: TINY_JPEG.length,
      source: "staff",
    });
    expect(rows?.[0]?.storage_path).toMatch(new RegExp(`^${org}/[0-9a-f-]{36}/porch\\.jpg$`));
    const { data: lead } = await db.from("leads").select("score_factors").eq("id", id).single();
    const factors = (lead?.score_factors ?? []) as { factor: string }[];
    expect(factors.map((f) => f.factor)).toContain("uploaded_photos");
  });

  test("step 1 and step 3 pass axe", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openWizard(page);
    const scan = async () =>
      (
        await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
          .analyze()
      ).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(await scan()).toEqual([]);
    await fillStep1(page, `Axe${uniq()}`, fakePhone().typed);
    await next(page).click();
    expect(await scan()).toEqual([]);
    await next(page).click();
    expect(await scan()).toEqual([]);
  });
});

test.describe("New Lead wizard on a phone", () => {
  test("no horizontal scroll at 390px, keyboard reaches Next, screenshot", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(MOBILE);
    await openWizard(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByLabel("First name").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    const nextBox = await next(page).boundingBox();
    expect(nextBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByLabel("First name").fill("Mo");
    await page.getByLabel("Last name").fill("Bile");
    await shot(page, "leads-new-mobile", false);
    // Keyboard only: Enter in a field moves to the next step when valid.
    await page.getByLabel("Email").fill(`mo-${uniq()}@example.com`);
    await page.getByLabel("Email").press("Enter");
    await expect(heading(page, "The property")).toBeFocused();
  });
});
