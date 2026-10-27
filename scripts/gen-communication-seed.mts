// Writes supabase/migrations/20261029000200_communication_seed.sql from the
// TypeScript defaults (templates, workflows, follow-up lists, dispositions,
// drips, notification defaults). Run once when the defaults change:
//   node --experimental-strip-types scripts/gen-communication-seed.mts
// lib/domain/templates/seed-sync.test.ts fails when the two drift.
// (Edits after a migration is applied in production go in a new migration.)
import { writeFileSync } from "node:fs";
import { DEFAULT_TEMPLATES } from "../lib/domain/templates/defaults.ts";
import { WORKFLOWS } from "../lib/domain/workflows/catalog.ts";
import { FOLLOW_UP_LISTS, DEFAULT_DISPOSITIONS } from "../lib/domain/follow-ups/index.ts";
import { DEFAULT_DRIPS } from "../lib/domain/drips/defaults.ts";
import { NOTIFICATION_TYPES } from "../lib/domain/notifications/catalog.ts";

const q = (v: string | null | undefined) =>
  v === null || v === undefined ? "null" : `'${v.replace(/'/g, "''")}'`;
const b = (v: boolean) => (v ? "true" : "false");

const templates = DEFAULT_TEMPLATES.map(
  (t) =>
    `    (p_org, ${q(t.key)}, ${q(t.channel)}, ${q(t.name)}, ${q(t.description)}, ${q(t.category)}, ${q(t.subject ?? null)}, ${q(t.body)}, ${q(t.messageType)}, true)`,
).join(",\n");

const workflows = WORKFLOWS.map((w) => `    (p_org, ${q(w.key)})`).join(",\n");

const lists = FOLLOW_UP_LISTS.map(
  (l, i) =>
    `    (p_org, ${q(l.key)}, ${q(l.name)}, ${q(l.description)}, ${q(l.script)}, ${l.cooldownHours}, ${(i + 1) * 10})`,
).join(",\n");

const dispositions = DEFAULT_DISPOSITIONS.map(
  (d, i) =>
    `    (p_org, ${q(d.key)}, ${q(d.label)}, ${q(d.group)}, ${q(d.leadDisposition)}, ${b(d.requiresCallback)}, ${b(d.setsDoNotContact)}, ${(i + 1) * 10})`,
).join(",\n");

const drips = DEFAULT_DRIPS.map(
  (d) =>
    `    (p_org, ${q(d.key)}, ${q(d.name)}, ${q(d.description)}, ${q(JSON.stringify(d.steps))}::jsonb, ${q(`{${d.exitConditions.join(",")}}`)}::text[], true)`,
).join(",\n");

const notifications = NOTIFICATION_TYPES.map(
  (n) =>
    `    (p_org, ${q(n.type)}, ${b(n.defaults.inApp)}, ${b(n.defaults.email)}, ${b(n.defaults.sms)}, ${b(n.defaults.locked)})`,
).join(",\n");

const sql = `-- Phase 8 · Communication & growth configuration seed (SPEC §11.2, §11.3,
-- §11.4, §8.11, §8.16, §8.18, §8.19, §9, §15.1).
--
-- Real configuration only, no messages or campaigns. Generated from the
-- TypeScript defaults by scripts/gen-communication-seed.mts (a unit test keeps
-- them in step):
-- - SMS and email templates for every seeded workflow, the onboarding requests,
--   the drips and warranty cases, all "Draft – owner to approve";
-- - the 17 workflows of SPEC §11.2, all ON (definitions live in
--   lib/domain/workflows/catalog.ts; this is their switch);
-- - the 8 follow-up lists and the dispositions (Positive / Negative / Callback /
--   No Contact / Won);
-- - the just-planning nurture and exterior pre-season drips;
-- - notification defaults per event, messaging settings (quiet hours 8 pm–8 am
--   Pacific), referral settings (reward stays in Company Settings, unset), and
--   the two new attention rules (unread customer message, warranty request).
--
-- Idempotent (on conflict do nothing): safe to run on a database that already
-- has Phases 0–7 and never overwrites what owners have edited.
--
-- Rollback: supabase/rollbacks/20261029000200_communication_seed.down.sql

create or replace function app.seed_communication_defaults(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.message_templates (org_id, key, channel, name, description, category, subject, body, message_type, is_system)
  values
${templates}
  on conflict (org_id, key, channel) do nothing;
  insert into public.workflows (org_id, key)
  values
${workflows}
  on conflict (org_id, key) do nothing;

  insert into public.follow_up_lists (org_id, key, name, description, script, cooldown_hours, sort_order)
  values
${lists}
  on conflict (org_id, key) do nothing;

  insert into public.follow_up_dispositions (org_id, key, label, disposition_group, lead_disposition,
    requires_callback, sets_do_not_contact, sort_order)
  values
${dispositions}
  on conflict (org_id, key) do nothing;

  insert into public.drips (org_id, key, name, description, steps, exit_conditions, is_system)
  values
${drips}
  on conflict (org_id, key) where key is not null do nothing;

  insert into public.notification_settings (org_id, type, in_app, email, sms, locked)
  values
${notifications}
  on conflict (org_id, type) do nothing;

  insert into public.messaging_settings (org_id) values (p_org) on conflict (org_id) do nothing;
  insert into public.referral_settings (org_id, program_note)
  values (p_org, 'Draft – owner to approve: past customers share their code; when a referred job is paid in full, the champion gets the reward in Company Settings.')
  on conflict (org_id) do nothing;

  insert into public.attention_rules (org_id, rule_key, enabled, thresholds) values
    (p_org, 'unread_message', true, '{"minutes": 30}'::jsonb),
    (p_org, 'warranty_request', true, '{}'::jsonb)
  on conflict (org_id, rule_key) do nothing;
end;
$$;
revoke execute on function app.seed_communication_defaults(uuid) from public, anon, authenticated;

select app.seed_communication_defaults(id) from public.organizations;
`;

writeFileSync("supabase/migrations/20261029000200_communication_seed.sql", sql);
console.log(
  `templates ${DEFAULT_TEMPLATES.length}, workflows ${WORKFLOWS.length}, lists ${FOLLOW_UP_LISTS.length}, dispositions ${DEFAULT_DISPOSITIONS.length}, drips ${DEFAULT_DRIPS.length}, notification types ${NOTIFICATION_TYPES.length}`,
);
