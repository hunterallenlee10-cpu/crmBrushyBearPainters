import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Page, expect } from "@playwright/test";
import { totp } from "./totp";

/**
 * Test users for E2E (one per role), created with the service role against the
 * LOCAL Supabase stack. Emails use a reserved test domain; nothing is sent.
 */

export type TestRole = "owner" | "office_manager" | "painter" | "bookkeeper" | "estimator";

export const TEST_USERS: Record<TestRole, { email: string; fullName: string; template: string }> = {
  owner: { email: "e2e-owner@test.brushybear.local", fullName: "Olive Owner", template: "owner" },
  office_manager: {
    email: "e2e-office@test.brushybear.local",
    fullName: "Otto Office",
    template: "office_manager",
  },
  painter: {
    email: "e2e-painter@test.brushybear.local",
    fullName: "Pat Painter",
    template: "painter",
  },
  bookkeeper: {
    email: "e2e-books@test.brushybear.local",
    fullName: "Bea Books",
    template: "bookkeeper",
  },
  estimator: {
    email: "e2e-estimator@test.brushybear.local",
    fullName: "Eli Estimator",
    template: "estimator",
  },
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for E2E (local Supabase). See README → E2E.`);
  return v;
}

export function adminClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page < 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u) return u.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Deletes and recreates every test user so each run starts clean (fresh MFA). */
export async function resetTestUsers(): Promise<Record<TestRole, string>> {
  const admin = adminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  if (error || !org) throw new Error("brushy-bear org missing — run `pnpm supabase db reset`.");

  const ids = {} as Record<TestRole, string>;
  for (const [role, u] of Object.entries(TEST_USERS) as [
    TestRole,
    (typeof TEST_USERS)[TestRole],
  ][]) {
    const existing = await findUserId(admin, u.email);
    if (existing) {
      // Profiles are protected from deletion; recycle the row instead.
      await admin.from("user_permission_overrides").delete().eq("user_id", existing);
      const { data: tpl } = await admin
        .from("role_templates")
        .select("id")
        .eq("org_id", org.id)
        .eq("key", u.template)
        .single();
      await admin
        .from("profiles")
        .update({ full_name: u.fullName, is_active: true, role_template_id: tpl?.id, title: null })
        .eq("id", existing);
      const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: existing });
      for (const f of factors?.factors ?? [])
        await admin.auth.admin.mfa.deleteFactor({ userId: existing, id: f.id });
      ids[role] = existing;
      continue;
    }
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: u.email,
      email_confirm: true,
    });
    if (cErr || !created.user) throw cErr ?? new Error("createUser failed");
    const { data: tpl } = await admin
      .from("role_templates")
      .select("id")
      .eq("org_id", org.id)
      .eq("key", u.template)
      .single();
    const { error: pErr } = await admin.from("profiles").insert({
      id: created.user.id,
      org_id: org.id,
      email: u.email,
      full_name: u.fullName,
      role_template_id: tpl?.id,
    });
    if (pErr) throw pErr;
    ids[role] = created.user.id;
  }
  return ids;
}

const LOCK_DIR = join(process.cwd(), "tests", "e2e", ".auth", "locks");

/**
 * Only one sign-in per email at a time, across all Playwright workers: a new
 * magic link cancels the previous one, so parallel sign-ins as the same user
 * would otherwise fail at random.
 */
async function withEmailLock<T>(email: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(LOCK_DIR, { recursive: true });
  const lock = join(LOCK_DIR, email.replace(/[^a-z0-9]/gi, "_"));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      // Clear a lock left behind by a crashed worker.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000)
          rmSync(lock, { recursive: true, force: true });
      } catch {
        // already released
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting to sign in as ${email}`);
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

async function openMagicLink(page: Page, email: string, next: string): Promise<void> {
  const admin = adminClient();
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data.properties?.hashed_token) throw error ?? new Error("generateLink failed");
    await page.goto(
      `/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(next)}`,
    );
    if (!page.url().includes("error=link_expired") || attempt >= 3) return;
  }
}

/** Signs in through the real magic-link route using a one-time token from the admin API. */
export async function signInWithMagicLink(page: Page, email: string, next = "/"): Promise<void> {
  await withEmailLock(email, () => openMagicLink(page, email, next));
}

/** Completes the MFA screen: enrolls on first sign-in (reading the setup key) or answers the challenge. */
export async function completeMfa(page: Page, secret?: string): Promise<string> {
  await expect(page).toHaveURL(/\/mfa$/);
  const keyEl = page.getByTestId("totp-secret");
  const codeInput = page.getByLabel("6-digit code");
  await expect(codeInput).toBeVisible();
  let key = secret;
  if (await keyEl.isVisible()) key = (await keyEl.textContent())?.trim() ?? undefined;
  if (!key) throw new Error("No TOTP secret available for the MFA challenge");
  const rejected = page.getByText(/that code didn't work/i);
  for (let attempt = 1; ; attempt++) {
    // Avoid the last two seconds of a 30-second window.
    if (Date.now() % 30000 > 28000) await page.waitForTimeout(2500);
    await codeInput.fill(totp(key));
    await page.getByRole("button", { name: /turn on two-step sign-in|verify/i }).click();
    // Either we leave /mfa (accepted; the next page may take a while to compile in dev)
    // or the form says the code was rejected.
    const outcome = await Promise.race([
      page
        .waitForURL((url) => !url.pathname.endsWith("/mfa"), { timeout: 60_000 })
        .then(() => "accepted" as const),
      rejected.waitFor({ state: "visible", timeout: 60_000 }).then(() => "rejected" as const),
    ]);
    if (outcome === "accepted") break;
    // A code can only be used once: wait for the next window and try again.
    if (attempt >= 2) throw new Error("The two-step code was rejected twice.");
    await page.waitForTimeout(30000 - (Date.now() % 30000) + 500);
  }
  return key;
}

/**
 * Fresh sign-in for one spec (its own session, so parallel specs never share a
 * refresh token). Answers the MFA challenge with the secret saved by auth.setup.ts.
 */
export async function loginAs(page: Page, role: TestRole, next = "/"): Promise<void> {
  const email = TEST_USERS[role].email;
  await withEmailLock(email, async () => {
    await openMagicLink(page, email, next);
    if (/\/mfa$/.test(page.url())) {
      const secrets = JSON.parse(
        readFileSync(join(process.cwd(), "tests", "e2e", ".auth", "secrets.json"), "utf8"),
      ) as Partial<Record<TestRole, string>>;
      await completeMfa(page, secrets[role]);
      if (next !== "/") await page.goto(next);
    }
  });
  // Wait for hydration so typed input reaches React state.
  await page.waitForLoadState("networkidle");
}

/**
 * Creates a disposable user on the given template for tests that change or
 * deactivate users. Never modify the shared TEST_USERS in specs.
 */
export async function createThrowawayUser(
  template: string,
  label = "temp",
): Promise<{ id: string; email: string; fullName: string }> {
  const admin = adminClient();
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `e2e-${label}-${suffix}@test.brushybear.local`;
  const fullName = `Temp ${label} ${suffix}`;
  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  const { data: tpl } = await admin
    .from("role_templates")
    .select("id")
    .eq("org_id", org?.id)
    .eq("key", template)
    .single();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || !created.user) throw error ?? new Error("createUser failed");
  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id,
    org_id: org?.id,
    email,
    full_name: fullName,
    role_template_id: tpl?.id,
  });
  if (pErr) throw pErr;
  return { id: created.user.id, email, fullName };
}
