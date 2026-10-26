import "server-only";
import { type z } from "zod";
import { getViewerState, type Viewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { runAction, type ActionDefinition } from "@/lib/actions/run-action";
import { type ActionResult } from "@/lib/actions/errors";
import { logError } from "@/lib/log";

export type ActionContext = {
  viewer: Viewer;
  /** User-scoped client: RLS applies. Use this for every mutation you can. */
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  /** Service-role client (bypasses RLS) that records the viewer as the actor. Only after explicit checks. */
  service: () => Promise<Awaited<ReturnType<typeof createSupabaseServiceClient>>>;
};

/** Wrap a Server Action handler. Usage: `export const saveX = defineAction({...})` in a "use server" file. */
export function defineAction<S extends z.ZodType, T>(def: ActionDefinition<S, T, ActionContext>) {
  return async (raw: z.input<S>): Promise<ActionResult<T>> => {
    let viewerRef: Viewer | null = null;
    return runAction(def, raw, {
      getViewer: async () => {
        const state = await getViewerState();
        viewerRef = state.status === "ok" ? state.viewer : null;
        return viewerRef;
      },
      makeContext: async () => {
        const viewer = viewerRef as Viewer;
        return {
          viewer,
          supabase: await createSupabaseServerClient(),
          service: () => createSupabaseServiceClient({ actorId: viewer.id }),
        };
      },
      onError: (name, error) => logError(`action:${name}`, error),
    });
  };
}
