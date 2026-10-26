import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminClient, loginAs, TEST_USERS } from "./support/users";

/**
 * Accounts & Contacts (SPEC §5.1, §8.10, §13.1–13.3): create an account with
 * its primary contact and property, gate codes (encrypted, shown on request),
 * consent rules, list search, scope and permissions, soft delete.
 * Signed in as the Owner unless a test uses `loginAs`. Everything created here
 * is removed again with the service role.
 */

const uniq = () => randomUUID().slice(0, 8);
const randomMobile = () => `+1425555${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
const asDisplay = (e164: string) => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
const SCREENS = "docs/screens/phase-2";

const created = { accounts: new Set<string>() };

async function orgAndUser(email: string): Promise<{ orgId: string; userId: string }> {
  const { data, error } = await adminClient()
    .from("profiles")
    .select("id, org_id")
    .eq("email", email)
    .single();
  if (error || !data) throw error ?? new Error(`No profile for ${email}`);
  return { orgId: data.org_id as string, userId: data.id as string };
}

/** Account + primary contact + primary property, straight into the DB. */
async function seedAccount(opts: {
  ownerEmail: string;
  name?: string;
  mobile?: string;
  zip?: string;
  withSecret?: boolean;
}): Promise<{ accountId: string; contactId: string; propertyId: string; name: string }> {
  const admin = adminClient();
  const { orgId, userId } = await orgAndUser(opts.ownerEmail);
  const name = opts.name ?? `Test Residence ${uniq()}`;
  const { data: acc, error: aErr } = await admin
    .from("accounts")
    .insert({ org_id: orgId, display_name: name, owner_id: userId, created_by: userId })
    .select("id")
    .single();
  if (aErr || !acc) throw aErr ?? new Error("account insert failed");
  created.accounts.add(acc.id as string);
  const { data: contact, error: cErr } = await admin
    .from("contacts")
    .insert({
      org_id: orgId,
      account_id: acc.id,
      first_name: "Casey",
      last_name: `Seed ${uniq()}`,
      mobile: opts.mobile ?? randomMobile(),
      email: `seed-${uniq()}@example.com`,
    })
    .select("id")
    .single();
  if (cErr || !contact) throw cErr ?? new Error("contact insert failed");
  await admin.from("accounts").update({ primary_contact_id: contact.id }).eq("id", acc.id);
  const { data: prop, error: pErr } = await admin
    .from("properties")
    .insert({
      org_id: orgId,
      account_id: acc.id,
      is_primary: true,
      street: `${uniq()} Seed St`,
      city: "Kirkland",
      zip: opts.zip ?? "98033",
      year_built: 1990,
    })
    .select("id")
    .single();
  if (pErr || !prop) throw pErr ?? new Error("property insert failed");
  if (opts.withSecret) {
    // A well-formed placeholder; nobody in these tests can decrypt it.
    await admin.from("property_secrets").insert({
      property_id: prop.id,
      org_id: orgId,
      access_code_ciphertext: "v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCC",
    });
  }
  return {
    accountId: acc.id as string,
    contactId: contact.id as string,
    propertyId: prop.id as string,
    name,
  };
}

/** Hard-deletes accounts and everything hanging off them, in FK order. */
async function cleanup(accountIds: Iterable<string>) {
  const ids = [...accountIds];
  if (!ids.length) return;
  const admin = adminClient();
  const { data: props } = await admin.from("properties").select("id").in("account_id", ids);
  const propIds = (props ?? []).map((p) => p.id as string);
  if (propIds.length) await admin.from("property_secrets").delete().in("property_id", propIds);
  await admin.from("properties").delete().in("account_id", ids);
  await admin.from("accounts").update({ primary_contact_id: null }).in("id", ids);
  await admin.from("contacts").delete().in("account_id", ids);
  await admin.from("accounts").delete().in("id", ids);
}

/** Navigate and wait for the client bundle, so the first click reaches React. */
async function open(page: Page, url: string) {
  const res = await page.goto(url);
  await page.waitForLoadState("networkidle");
  return res;
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test.describe("accounts & contacts", () => {
  test.skip(({ isMobile }) => isMobile, "desktop flow; the 390px layout is checked inside");

  test.afterAll(async () => {
    await cleanup(created.accounts);
  });

  test("owner creates an account, sets a gate code, finds it, then deletes it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tag = uniq();
    const name = `Test Residence ${tag}`;
    const mobile = randomMobile();
    const street = `${Math.floor(Math.random() * 9000) + 1000} Larch ${tag} Ln`;
    const code = `48${Math.floor(Math.random() * 90) + 10}#`;

    await open(page, "/accounts");
    await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
    await page.getByRole("button", { name: "New account" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New account" });
    await dialog.getByLabel("First name").fill("Tess");
    await dialog.getByLabel("Last name").fill(`Tester${tag}`);
    await dialog.getByLabel("Mobile").fill(asDisplay(mobile));
    await dialog.getByLabel("Email", { exact: true }).fill(`tess-${tag}@example.com`);
    await dialog.getByLabel("Street address").fill(street);
    await dialog.getByLabel("City").fill("Kirkland");
    await dialog.getByLabel("ZIP").fill("98033");
    await dialog.getByLabel("Year built").fill("1965");
    await expect(dialog.getByText("Lead-safe (pre-1978)")).toBeVisible();
    await expect.poll(async () => seriousAxe(page)).toEqual([]);
    await expect(dialog.getByLabel("Account name")).toHaveValue(`Tester${tag} Residence`);
    await dialog.getByLabel("Account name").fill(name);
    await dialog.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const accountId = page.url().split("/").pop()!;
    created.accounts.add(accountId);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    // Contact, property, territory and lead-safe flag.
    const contacts = page.getByRole("region", { name: /Contacts/ });
    await expect(contacts.getByRole("link", { name: `Tess Tester${tag}` })).toBeVisible();
    await expect(contacts.getByText("Primary", { exact: true }).first()).toBeVisible();
    await expect(contacts.getByText(asDisplay(mobile))).toBeVisible();
    const properties = page.getByRole("region", { name: /Properties/ });
    await expect(properties.getByRole("heading", { name: street })).toBeVisible();
    await expect(properties.getByText("Kirkland", { exact: true })).toBeVisible();
    await expect(properties.getByText("Lead-safe (pre-1978)")).toBeVisible();

    const admin = adminClient();
    const { data: acc } = await admin
      .from("accounts")
      .select("primary_contact_id, territory_id, status, account_type")
      .eq("id", accountId)
      .single();
    expect(acc?.primary_contact_id).toBeTruthy();
    expect(acc?.territory_id).toBeTruthy();
    expect(acc).toMatchObject({ status: "prospect", account_type: "residential" });

    // Gate code: encrypted at rest, shown only on request.
    await properties.getByRole("button", { name: "Set code" }).click();
    await properties.getByLabel("Gate / lockbox code").fill(code);
    await properties.getByRole("button", { name: "Save code" }).click();
    await expect(properties.getByRole("button", { name: "Show code" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(code)).toHaveCount(0);
    const { data: prop } = await admin
      .from("properties")
      .select("id, lead_safe_required")
      .eq("account_id", accountId)
      .single();
    expect(prop?.lead_safe_required).toBe(true);
    const { data: secret } = await admin
      .from("property_secrets")
      .select("access_code_ciphertext")
      .eq("property_id", prop!.id)
      .single();
    expect(secret?.access_code_ciphertext.startsWith("v1:")).toBe(true);
    expect(secret?.access_code_ciphertext).not.toContain(code);
    expect(secret?.access_code_ciphertext).not.toContain(code.replace("#", ""));
    const html = await page.content();
    expect(html).not.toContain(secret!.access_code_ciphertext);

    await properties.getByRole("button", { name: "Show code" }).click();
    await expect(properties.getByTestId("access-code-value")).toHaveText(code);
    await expect(page.getByRole("region", { name: /Timeline/ })).toContainText(
      "Viewed the gate/lockbox code",
    );
    await properties.getByRole("button", { name: "Hide code" }).click();

    await expect.poll(async () => seriousAxe(page)).toEqual([]);
    await page.screenshot({ path: `${SCREENS}/accounts-detail.png`, fullPage: true });

    // Mobile width: no sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({ path: `${SCREENS}/accounts-detail-mobile.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    // The list finds it by name and by street address.
    await page.goto(`/accounts?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await page.goto(`/accounts?q=${encodeURIComponent(`Larch ${tag}`)}`);
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await open(page, "/accounts");
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await expect.poll(async () => seriousAxe(page)).toEqual([]);
    await page.screenshot({ path: `${SCREENS}/accounts-list.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Preview drawer.
    await page.getByRole("button", { name: `Preview ${name}` }).click();
    const drawer = page.getByRole("dialog", { name });
    await expect(drawer.getByText(`Tess Tester${tag}`)).toBeVisible();
    await expect(drawer.getByText("Lead-safe (pre-1978)")).toBeVisible();
    await page.keyboard.press("Escape");

    // Delete with a reason → soft-deleted and gone from the list.
    await open(page, `/accounts/${accountId}`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const del = page.getByRole("dialog", { name: "Delete this account?" });
    await del.getByRole("button", { name: "Delete account" }).click();
    await expect(del.getByText(/Give a short reason/)).toBeVisible();
    await del.getByLabel("Reason").fill("E2E test cleanup");
    await del.getByRole("button", { name: "Delete account" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
    await page.goto(`/accounts?q=${encodeURIComponent(name)}`);
    await expect(page.getByText("No accounts match these filters")).toBeVisible();
    const { data: gone } = await admin
      .from("accounts")
      .select("deleted_at, delete_reason")
      .eq("id", accountId)
      .single();
    expect(gone?.deleted_at).toBeTruthy();
    expect(gone?.delete_reason).toBe("E2E test cleanup");
    expect((await page.goto(`/accounts/${accountId}`))?.status()).toBe(404);
  });

  test("consent needs a source, Do Not Contact clears it, and the list finds phone digits", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const mobile = randomMobile();
    const seeded = await seedAccount({ ownerEmail: TEST_USERS.owner.email, mobile });
    const admin = adminClient();

    await open(page, `/contacts/${seeded.contactId}`);
    await expect(page.getByRole("heading", { level: 1, name: /Casey Seed/ })).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /Edit Casey Seed/ });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByLabel("Opted in to marketing texts").check();
    await dialog.getByRole("button", { name: "Save contact" }).click();
    await expect(dialog.getByText(/Say where they agreed to texts/)).toBeVisible();
    await dialog.getByLabel("Where did they agree to texts?").fill("Verbally on a call, E2E");
    await dialog.getByRole("button", { name: "Save contact" }).click();
    await expect(dialog).toBeHidden();

    const consent = page.getByTestId("consent-details");
    await expect(consent).toContainText("Opted in");
    await expect(consent).toContainText("Source: Verbally on a call, E2E");
    const { data: after } = await admin
      .from("contacts")
      .select("sms_opt_in, sms_opt_in_at, sms_opt_in_source")
      .eq("id", seeded.contactId)
      .single();
    expect(after?.sms_opt_in).toBe(true);
    expect(after?.sms_opt_in_at).toBeTruthy();
    expect(after?.sms_opt_in_source).toBe("Verbally on a call, E2E");

    await expect.poll(async () => seriousAxe(page)).toEqual([]);
    await page.screenshot({ path: `${SCREENS}/contacts-detail.png`, fullPage: true });

    // Do Not Contact clears consent.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const again = page.getByRole("dialog", { name: /Edit Casey Seed/ });
    await again.getByLabel("Do not contact").check();
    await expect(again.getByLabel("Opted in to marketing texts")).toBeDisabled();
    await again.getByRole("button", { name: "Save contact" }).click();
    await expect(again).toBeHidden();
    await expect(page.getByTestId("consent-details")).toContainText("Do not contact");
    const { data: dnc } = await admin
      .from("contacts")
      .select("sms_opt_in, sms_opt_in_at, email_opt_in, do_not_contact")
      .eq("id", seeded.contactId)
      .single();
    expect(dnc).toMatchObject({
      sms_opt_in: false,
      sms_opt_in_at: null,
      email_opt_in: false,
      do_not_contact: true,
    });

    // The contacts list finds them by phone digits (typed into the search box).
    await open(page, "/contacts");
    await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
    await expect(page.locator("[data-list-ready=true]")).toBeAttached();
    await page.getByRole("searchbox", { name: "Search contacts" }).fill(mobile.slice(-7));
    await expect(page).toHaveURL(new RegExp(`q=${mobile.slice(-7)}`));
    await expect(page.getByRole("link", { name: /Casey Seed/ })).toBeVisible();
    await page.getByRole("button", { name: "Do not contact" }).first().click();
    await expect(page.getByRole("link", { name: /Casey Seed/ })).toBeVisible();
    // "Mine" = contacts on accounts the viewer owns (the owner owns the seeded account).
    await page.goto(`/contacts?tab=mine&q=${mobile.slice(-7)}`);
    await expect(page.getByRole("link", { name: /Casey Seed/ })).toBeVisible();
    await page.goto("/contacts");
    await expect.poll(async () => seriousAxe(page)).toEqual([]);
    await page.screenshot({ path: `${SCREENS}/contacts-list.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalScroll(page);
  });

  test("an estimator only sees their own accounts and never gate codes", async ({ page }) => {
    test.setTimeout(120_000);
    const others = await seedAccount({ ownerEmail: TEST_USERS.owner.email, withSecret: true });
    const mine = await seedAccount({ ownerEmail: TEST_USERS.estimator.email, withSecret: true });

    await loginAs(page, "estimator", "/accounts");
    await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
    expect((await page.goto(`/accounts/${others.accountId}`))?.status()).toBe(404);
    expect((await page.goto(`/contacts/${others.contactId}`))?.status()).toBe(404);
    await page.goto(`/accounts?q=${encodeURIComponent(others.name)}`);
    await expect(page.getByText("No accounts match these filters")).toBeVisible();

    // Their own account opens, but the gate-code control isn't there at all.
    const res = await page.goto(`/accounts/${mine.accountId}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: mine.name })).toBeVisible();
    await expect(page.getByRole("region", { name: /Properties/ })).toContainText("Seed St");
    await expect(page.getByText(/Gate \/ lockbox code/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show code" })).toHaveCount(0);
    expect(await page.content()).not.toContain("v1:AAAA");
  });

  test("a painter can't open accounts or contacts", async ({ page }) => {
    await loginAs(page, "painter");
    expect((await page.goto("/accounts"))?.status()).toBe(404);
    expect((await page.goto("/contacts"))?.status()).toBe(404);
  });
});
