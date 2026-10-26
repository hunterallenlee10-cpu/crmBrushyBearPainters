import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  TEST_USERS,
  adminClient,
  createThrowawayUser,
  loginAs,
  type TestRole,
  signInWithMagicLink,
} from "./support/users";

/**
 * Admin → Users, user detail and /settings (SPEC §4, §8.18, §8.19).
 * Every test signs in fresh; anything that changes a user uses a throwaway user.
 */
test.use({ storageState: { cookies: [], origins: [] } });
// One worker, in order: magic links and TOTP codes for the same shared user race otherwise.
test.describe.configure({ mode: "default", timeout: 150_000 });

/**
 * `loginAs` with retries. Other specs may sign in as the same shared user at the
 * same moment, which invalidates our magic link (or reuses a TOTP window).
 */
async function signIn(page: Page, role: TestRole, next: string) {
  const authScreen = (url: URL) => ["/login", "/mfa", "/auth/confirm"].includes(url.pathname);
  for (let attempt = 1; ; attempt++) {
    try {
      await loginAs(page, role, next);
    } catch (error) {
      if (attempt >= 4) throw error;
    }
    const signedIn = await page
      .waitForURL((url) => !authScreen(url), { timeout: 15_000, waitUntil: "commit" })
      .then(
        () => true,
        () => false,
      );
    if (signedIn) return;
    if (attempt >= 4) throw new Error(`Could not sign in as ${role}: ended on ${page.url()}`);
    // A rejected TOTP code needs the next 30-second window; a lost magic link just a moment.
    const onMfa = new URL(page.url()).pathname === "/mfa";
    await page.waitForTimeout(
      onMfa ? 30_500 - (Date.now() % 30_000) : 1_000 + Math.random() * 3_000,
    );
  }
}

const rand = () => Math.random().toString(36).slice(2, 8);

/** Throwaway users created here are deactivated afterwards so the Active list stays readable. */
const created: string[] = [];
async function throwaway(template: string, label: string) {
  const u = await createThrowawayUser(template, label);
  created.push(u.id);
  return u;
}
test.afterAll(async () => {
  if (created.length)
    await adminClient().from("profiles").update({ is_active: false }).in("id", created);
});

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page should not scroll sideways").toBeLessThanOrEqual(0);
}

/** Users show as a table on desktop and as a stacked list on phones. */
function usersView(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1440) < 768;
  const root = mobile ? page.getByRole("list", { name: "Users list" }) : page.getByRole("table");
  return {
    root,
    entry: (re: RegExp) =>
      mobile
        ? root.getByRole("listitem").filter({ hasText: re })
        : root.getByRole("row", { name: re }),
    entries: () =>
      mobile
        ? root.getByRole("listitem")
        : root.getByRole("row").filter({ hasNot: page.getByRole("columnheader") }),
  };
}

test.describe("Admin → Users", () => {
  test("owner sees the users table and invites a user (simulated email)", async ({ page }) => {
    await signIn(page, "owner", "/admin/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    const users = usersView(page);
    await expect(users.entry(new RegExp(TEST_USERS.owner.email))).toBeVisible();
    await expect(page.getByRole("tab", { name: /Active/ })).toHaveAttribute("data-state", "active");

    const suffix = rand();
    const email = `e2e-invite-${suffix}@test.brushybear.local`;
    const name = `Ivy Invite ${suffix}`;

    await page.getByRole("button", { name: "Invite user" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a user" });
    // Owners can pick the Owner template.
    await expect(dialog.getByRole("option", { name: "Owner", exact: true })).toHaveCount(1);
    await dialog.getByRole("textbox", { name: "Full name", exact: true }).fill(name);
    await dialog
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(`  ${email.toUpperCase()} `);
    await dialog
      .getByRole("combobox", { name: "Role", exact: true })
      .selectOption({ label: "Painter (Crew Member)" });
    await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Painter");
    await dialog.getByRole("textbox", { name: "Department", exact: true }).fill("Field");
    await dialog.getByRole("button", { name: "Send invite" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/in the outbox as Simulated/)).toBeVisible();

    const row = users.entry(new RegExp(email));
    await expect(row).toBeVisible();
    await expect(row).toContainText(name);
    await expect(row).toContainText("Painter (Crew Member)");
    await expect(row).toContainText("Active");

    const admin = adminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email, invited_at, invited_by, title, department")
      .eq("email", email)
      .single();
    expect(profile?.invited_at).toBeTruthy();
    expect(profile?.invited_by).toBeTruthy();
    expect(profile?.department).toBe("Field");

    const { data: outbox } = await admin
      .from("integration_outbox")
      .select("status, domain, provider, subject, rendered_body, related_id")
      .eq("recipient", email);
    expect(outbox).toHaveLength(1);
    expect(outbox?.[0]).toMatchObject({
      status: "simulated",
      domain: "email",
      provider: "outbox",
      subject: "You're invited to Brushy Bear CRM",
      related_id: profile?.id,
    });
    expect(outbox?.[0]?.rendered_body).toContain("/login");

    // A second invite to the same email is refused with a friendly message.
    await page.getByRole("button", { name: "Invite user" }).click();
    await dialog.getByRole("textbox", { name: "Full name", exact: true }).fill(name);
    await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await dialog
      .getByRole("combobox", { name: "Role", exact: true })
      .selectOption({ label: "Painter (Crew Member)" });
    await dialog.getByRole("button", { name: "Send invite" }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "already a user" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Search filters the table.
    await page.getByLabel("Search users").fill(suffix);
    await expect(users.entries()).toHaveCount(1); // just the invite

    // Clean up: deactivate the invited user so lists stay tidy.
    if (profile?.id) await admin.from("profiles").update({ is_active: false }).eq("id", profile.id);
  });

  test("owner deactivates and reactivates a throwaway user", async ({ page }) => {
    const u = await throwaway("painter", "deact");
    const admin = adminClient();
    await signIn(page, "owner", `/admin/users/${u.id}`);
    await expect(page.getByRole("heading", { level: 1, name: u.fullName })).toBeVisible();

    await page.getByRole("button", { name: "Deactivate user" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByText("Open work to reassign")).toBeVisible();
    await expect(confirm.getByText("Nothing to reassign yet.")).toBeVisible();
    await confirm.getByRole("button", { name: "Deactivate", exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole("button", { name: "Reactivate user" })).toBeVisible();
    await expect(page.getByText("Deactivated", { exact: true }).first()).toBeVisible();

    const { data: off } = await admin
      .from("profiles")
      .select("is_active, deactivated_at, deactivated_by")
      .eq("id", u.id)
      .single();
    expect(off).toMatchObject({ is_active: false });
    expect(off?.deactivated_at).toBeTruthy();
    expect(off?.deactivated_by).toBeTruthy();
    const { data: banned } = await admin.auth.admin.getUserById(u.id);
    expect(new Date(banned.user?.banned_until ?? 0).getTime()).toBeGreaterThan(Date.now());

    await page.getByRole("button", { name: "Reactivate user" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Reactivate", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Deactivate user" })).toBeVisible();

    const { data: on } = await admin
      .from("profiles")
      .select("is_active, deactivated_at")
      .eq("id", u.id)
      .single();
    expect(on).toMatchObject({ is_active: true, deactivated_at: null });
    const { data: unbanned } = await admin.auth.admin.getUserById(u.id);
    const until = unbanned.user?.banned_until;
    expect(!until || new Date(until).getTime() <= Date.now()).toBe(true);
  });

  test("office manager can view users but cannot invite or deactivate", async ({ page }) => {
    const u = await throwaway("painter", "om");
    await signIn(page, "office_manager", "/admin/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    await expect(usersView(page).root).toBeVisible();
    await expect(page.getByRole("button", { name: "Invite user" })).toHaveCount(0);

    await page.goto(`/admin/users/${u.id}`);
    await expect(page.getByRole("heading", { level: 1, name: u.fullName })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deactivate user" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Edit profile" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change role" })).toHaveCount(0);
    await expect(page.getByText("Only people who can edit roles and permissions")).toBeVisible();
  });

  test("painter gets 404 on /admin/users", async ({ page }) => {
    await signIn(page, "painter", "/admin/users");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("owner adds and removes a per-user permission override", async ({ page }) => {
    const u = await throwaway("painter", "ovr");
    const admin = adminClient();
    await signIn(page, "owner", `/admin/users/${u.id}`);
    const card = page.getByRole("region", { name: "Permission overrides" });
    await expect(card.getByText(/^No overrides\./)).toBeVisible();

    // A reason is required.
    await card
      .getByRole("combobox", { name: "Permission", exact: true })
      .selectOption("leads:read");
    await card.getByRole("button", { name: "Add override" }).click();
    await expect(card.getByText(/at least 3 characters/)).toBeVisible();

    await card.getByRole("combobox", { name: "Effect", exact: true }).selectOption("grant");
    await card.getByRole("combobox", { name: "Scope", exact: true }).selectOption("own");
    await card
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Helping with intake calls");
    await card.getByRole("button", { name: "Add override" }).click();
    const list = card.getByRole("list", { name: "Current overrides" });
    await expect(list.getByText("View leads")).toBeVisible();
    await expect(list.getByText(/Helping with intake calls/)).toBeVisible();

    const { data: rows } = await admin
      .from("user_permission_overrides")
      .select("permission, effect, scope, reason")
      .eq("user_id", u.id);
    expect(rows).toEqual([
      {
        permission: "leads:read",
        effect: "grant",
        scope: "own",
        reason: "Helping with intake calls",
      },
    ]);

    await card.getByRole("button", { name: "Remove override for View leads" }).click();
    await expect(card.getByText(/^No overrides\./)).toBeVisible();
    const { data: after } = await admin
      .from("user_permission_overrides")
      .select("id")
      .eq("user_id", u.id);
    expect(after).toEqual([]);
  });

  test("owner user detail shows that owners have every permission", async ({ page }) => {
    const { data: owner } = await adminClient()
      .from("profiles")
      .select("id")
      .eq("email", TEST_USERS.owner.email)
      .single();
    await signIn(page, "owner", `/admin/users/${owner?.id}`);
    await expect(page.getByText("Owners have every permission")).toBeVisible();
    // You can't deactivate yourself.
    await expect(page.getByRole("button", { name: "Deactivate user" })).toHaveCount(0);
  });
});

test.describe("/settings", () => {
  test("a painter saves their own profile and preferences (audit-logged)", async ({ page }) => {
    const u = await throwaway("painter", "settings");
    const admin = adminClient();
    await signInWithMagicLink(page, u.email, "/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

    const newName = `${u.fullName} Renamed`;
    const save = page.getByRole("button", { name: "Save profile" });
    // Re-type if the page hydrates (or the shared dev server reloads) after the first fill.
    await expect(async () => {
      await page.getByRole("textbox", { name: "Full name", exact: true }).fill(newName);
      await page.getByRole("textbox", { name: "Job title", exact: true }).fill("Crew painter");
      await expect(save).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await save.click();
    await expect(page.getByText("Profile saved.")).toBeVisible();

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, title")
      .eq("id", u.id)
      .single();
    expect(profile).toEqual({ full_name: newName, title: "Crew painter" });

    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_id, changed_fields")
      .eq("table_name", "public.profiles")
      .eq("record_id", u.id)
      .eq("action", "update");
    expect(audit?.length).toBeGreaterThan(0);
    expect(audit?.some((a) => a.actor_id === u.id && a.changed_fields?.includes("full_name"))).toBe(
      true,
    );

    await page.getByRole("tab", { name: "Preferences" }).click();
    await page.getByLabel(/My Day/).check();
    await page.getByLabel(/24-hour/).check();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Preferences saved.")).toBeVisible();
    const { data: prefs } = await admin
      .from("profiles")
      .select("preferences")
      .eq("id", u.id)
      .single();
    expect(prefs?.preferences).toMatchObject({ default_home: "my_day", time_format: "24h" });

    await page.getByRole("tab", { name: "Security" }).click();
    await expect(page.getByRole("button", { name: "Set up two-step sign-in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out of all devices" })).toBeVisible();

    await page.getByRole("tab", { name: "Notifications" }).click();
    await expect(page.getByText(/arrive with notifications \(Phase 3\)/)).toBeVisible();
  });

  test("owner sees their verified authenticator and cannot remove the only one", async ({
    page,
  }) => {
    await signIn(page, "owner", "/settings");
    await page.getByRole("tab", { name: "Security" }).click();
    const list = page.getByRole("list", { name: "Authenticators" });
    await expect(list.getByText("Verified")).toBeVisible();
    await expect(list.getByRole("button", { name: /Remove/ })).toHaveCount(0);
    await expect(list.getByText(/Your role requires two-step sign-in/)).toBeVisible();
  });
});

test.describe("layout, accessibility and screenshots", () => {
  const OUT = join(process.cwd(), "docs", "screens", "phase-1");

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("users list, user detail and settings: no sideways scroll at 390px, no axe violations", async ({
    page,
  }) => {
    const u = await throwaway("painter", "layout");
    await signIn(page, "owner", "/admin/users");
    for (const path of ["/admin/users", `/admin/users/${u.id}`, "/settings"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      const results = await new AxeBuilder({ page }).include("main").analyze();
      expect(
        results.violations.map(
          (v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    }
  });

  test("screenshots for the phase report", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    const u = await throwaway("painter", "shot");
    const admin = adminClient();
    await admin
      .from("profiles")
      .update({ title: "Crew painter", department: "Field", phone: "(425) 555-0142" })
      .eq("id", u.id);
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", "brushy-bear")
      .single();
    await admin.from("user_permission_overrides").insert({
      org_id: org?.id,
      user_id: u.id,
      permission: "photos:delete",
      effect: "grant",
      scope: "all",
      reason: "Cleans up duplicate job photos",
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, "owner", "/admin/users");
    await expect(page.getByRole("table")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, "admin-users.png"), animations: "disabled" });

    await page.goto(`/admin/users/${u.id}`);
    await expect(page.getByRole("heading", { level: 1, name: u.fullName })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: join(OUT, "admin-user-detail.png"),
      fullPage: true,
      animations: "disabled",
    });

    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, "settings.png"), animations: "disabled" });
  });
});
