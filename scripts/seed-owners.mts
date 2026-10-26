/**
 * Creates the owner accounts (SPEC §15.1). Emails come from SEED_OWNER_EMAILS
 * (never hard-coded): a comma-separated list, in this order:
 *   1. Hunter Lee — Marketing & Customer Experience
 *   2. Erik       — Field Operations & Estimates
 * Extra emails become owners named after their address.
 *
 * Idempotent: existing users and profiles are left as they are. No email is
 * sent; owners sign in from /login with a magic link or Google.
 *
 *   pnpm seed:owners            (reads .env.local)
 */
import { createClient } from "@supabase/supabase-js";

const OWNERS = [
  { fullName: "Hunter Lee", department: "Marketing & Customer Experience" },
  { fullName: "Erik", department: "Field Operations & Estimates" },
];

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Set it in .env.local (see .env.example).`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const key = required("SUPABASE_SERVICE_ROLE_KEY");
  const emails = required("SEED_OWNER_EMAILS")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", "brushy-bear")
    .single();
  if (orgError || !org)
    throw new Error("Organization brushy-bear not found. Run migrations first.");

  const { data: template, error: tError } = await supabase
    .from("role_templates")
    .select("id")
    .eq("org_id", org.id)
    .eq("key", "owner")
    .single();
  if (tError || !template) throw new Error("Owner role template not found. Run migrations first.");

  for (const [i, email] of emails.entries()) {
    const meta = OWNERS[i] ?? { fullName: email.split("@")[0] ?? email, department: null };
    const userId = await findOrCreateUser(supabase, email);

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (existing) {
      console.log(`✓ ${meta.fullName} already set up`);
      continue;
    }
    const { error } = await supabase.from("profiles").insert({
      id: userId,
      org_id: org.id,
      email,
      full_name: meta.fullName,
      title: "Owner",
      department: meta.department,
      role_template_id: template.id,
      invited_at: new Date().toISOString(),
    });
    if (error) throw new Error(`Could not create profile for owner #${i + 1}: ${error.message}`);
    console.log(`✓ Created owner ${meta.fullName}`);
  }
}

async function findOrCreateUser(
  supabase: ReturnType<typeof createClient>,
  email: string,
): Promise<string> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user)
    throw new Error(`Could not create auth user: ${error?.message ?? "unknown error"}`);
  return data.user.id;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
