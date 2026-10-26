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

/** Signs in through the real magic-link route using a one-time token from the admin API. */
export async function signInWithMagicLink(page: Page, email: string, next = "/"): Promise<void> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw error ?? new Error("generateLink failed");
  await page.goto(
    `/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink&next=${encodeURIComponent(next)}`,
  );
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
  // Avoid the last two seconds of a 30-second window.
  if (Date.now() % 30000 > 28000) await page.waitForTimeout(2500);
  await codeInput.fill(totp(key));
  await page.getByRole("button", { name: /turn on two-step sign-in|verify/i }).click();
  await expect(page).not.toHaveURL(/\/mfa$/, { timeout: 15000 });
  return key;
}
