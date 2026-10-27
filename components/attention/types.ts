import type { ActionResult } from "@/lib/actions/errors";
import type { AttentionCategory, AttentionPriority } from "@/lib/domain/attention/rules";
import type { DueTone } from "./time";

/**
 * One attention item, ready to render. Times are formatted on the server so
 * the browser shows exactly what was computed (no hydration drift).
 */
export type AttentionItemView = {
  id: string;
  title: string;
  detail: string | null;
  category: AttentionCategory;
  priority: AttentionPriority;
  ruleLabel: string;
  status: "pending" | "in_progress" | "snoozed" | "resolved";
  subject: { type: "lead" | "job" | "subcontractor"; id: string; href: string; label: string };
  owner: { id: string; name: string; initials: string } | null;
  /** "opened 3 h ago" + full Pacific date for the tooltip. */
  opened: { label: string; title: string };
  /** SLA countdown from due_at. */
  due: { label: string; tone: DueTone; title: string } | null;
  snoozedUntil: string | null;
  resolution: {
    how: "auto" | "manual";
    note: string | null;
    when: string;
    by: string | null;
  } | null;
};

export type PersonOption = { id: string; name: string };

type Result = Promise<ActionResult<{ id: string; status: string }>>;

/** Server Actions handed down from the page (keeps these components free of app/ imports). */
export type AttentionActions = {
  assign: (input: { id: string; ownerId: string | null }) => Result;
  start: (input: { id: string }) => Result;
  reopen: (input: { id: string }) => Result;
  snooze: (input: { id: string; until: string }) => Result;
  resolve: (input: { id: string; note: string }) => Result;
};
