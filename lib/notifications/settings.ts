import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { NOTIFICATION_TYPES, effectiveChoice } from "@/lib/domain/notifications/catalog";
import type { MatrixRow } from "@/components/notifications/notification-matrix";

type Db = SupabaseClient<Database>;

/** Company defaults per notification type, with the catalog's for any type not seeded yet. */
export async function loadCompanyRows(db: Db): Promise<MatrixRow[]> {
  const { data } = await db
    .from("notification_settings")
    .select("type, in_app, email, sms, locked");
  const byType = new Map((data ?? []).map((r) => [r.type, r]));
  return NOTIFICATION_TYPES.map((t) => {
    const r = byType.get(t.type);
    return {
      type: t.type,
      label: t.label,
      description: t.description,
      inApp: r?.in_app ?? t.defaults.inApp,
      email: r?.email ?? t.defaults.email,
      sms: r?.sms ?? t.defaults.sms,
      locked: r?.locked ?? t.defaults.locked,
    };
  });
}

/** What this person gets per type: their own choice over the company default. */
export async function loadMyRows(db: Db, userId: string): Promise<MatrixRow[]> {
  const [company, { data }] = await Promise.all([
    loadCompanyRows(db),
    db.from("notification_preferences").select("type, in_app, email, sms").eq("user_id", userId),
  ]);
  const mine = new Map((data ?? []).map((r) => [r.type, r]));
  return company.map((c) => {
    const p = mine.get(c.type);
    const e = effectiveChoice(
      { inApp: c.inApp, email: c.email, sms: c.sms, locked: c.locked },
      p ? { inApp: p.in_app, email: p.email, sms: p.sms } : null,
    );
    return { ...c, ...e };
  });
}
