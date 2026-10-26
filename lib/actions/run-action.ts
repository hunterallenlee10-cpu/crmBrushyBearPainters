import { type z } from "zod";
import { type Permission } from "@/lib/permissions";
import { ActionFailure, actionError, type ActionResult } from "@/lib/actions/errors";

/**
 * The one pattern every mutation follows (SPEC §18 rule 9):
 *   1. validate input with zod
 *   2. require a signed-in viewer; refuse while viewing as another user
 *   3. check permissions server-side (Postgres RLS checks again)
 *   4. run the handler (mutations go through RLS; audit rows and domain
 *      events are written by database triggers in the same transaction)
 *
 * Pure and dependency-injected so it is unit-tested without Next.js or Supabase.
 */

export type ActionViewer = {
  id: string;
  impersonating: boolean;
  can: (permission: Permission) => boolean;
};

export type ActionDefinition<S extends z.ZodType, T, C> = {
  name: string;
  schema: S;
  /** All listed permissions are required. `null` = any signed-in user (e.g. edit own profile). */
  permissions: readonly Permission[] | null;
  handler: (input: z.infer<S>, ctx: C) => Promise<T>;
};

export type ActionDeps<C> = {
  getViewer: () => Promise<ActionViewer | null>;
  makeContext: (viewer: ActionViewer) => Promise<C>;
  onError?: (name: string, error: unknown) => void;
};

function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export async function runAction<S extends z.ZodType, T, C>(
  def: ActionDefinition<S, T, C>,
  raw: unknown,
  deps: ActionDeps<C>,
): Promise<ActionResult<T>> {
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: actionError("validation", undefined, fieldErrors(parsed.error)) };
  }

  const viewer = await deps.getViewer();
  if (!viewer) return { ok: false, error: actionError("unauthenticated") };
  if (viewer.impersonating) return { ok: false, error: actionError("read_only") };
  if (def.permissions && !def.permissions.every((p) => viewer.can(p))) {
    return { ok: false, error: actionError("forbidden") };
  }

  try {
    const ctx = await deps.makeContext(viewer);
    const data = await def.handler(parsed.data, ctx);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ActionFailure) return { ok: false, error: error.error };
    deps.onError?.(def.name, error);
    return { ok: false, error: actionError("server") };
  }
}
