/**
 * Maps database / PostgREST errors to safe, plain-English action errors.
 * Messages raised by our own guards (RAISE EXCEPTION … USING ERRCODE) are
 * written for users, so they pass through; anything else becomes generic.
 */

export type ActionErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "read_only"
  | "not_found"
  | "conflict"
  | "server";

export type ActionError = {
  code: ActionErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

type DbError = { code?: string | null; message?: string | null };

const GENERIC: Record<ActionErrorCode, string> = {
  validation: "Some fields need attention.",
  unauthenticated: "Your session ended. Sign in again.",
  forbidden: "You don't have permission to do that.",
  read_only: "You're viewing as another user. Exit View as user to make changes.",
  not_found: "That record no longer exists.",
  conflict: "That conflicts with an existing record.",
  server: "Something went wrong. Try again, and tell an owner if it keeps happening.",
};

/** Our guard messages are short sentences; Postgres internals are not shown. */
function friendly(message: string | null | undefined): string | null {
  if (!message) return null;
  if (
    /new row violates row-level security|permission denied for|violates foreign key|duplicate key value|violates check constraint|syntax|relation .* does not exist/i.test(
      message,
    )
  ) {
    return null;
  }
  return message.length <= 200 ? message : null;
}

export function mapDbError(error: DbError | null | undefined): ActionError {
  const code = error?.code ?? "";
  switch (code) {
    case "42501":
      return { code: "forbidden", message: friendly(error?.message) ?? GENERIC.forbidden };
    case "23505":
    case "40001":
      return { code: "conflict", message: friendly(error?.message) ?? GENERIC.conflict };
    case "23503":
      return {
        code: "conflict",
        message: friendly(error?.message) ?? "That record is still in use.",
      };
    case "23514":
    case "22023":
    case "22P02":
    case "23502":
      return { code: "validation", message: friendly(error?.message) ?? GENERIC.validation };
    case "P0002":
    case "PGRST116":
      return { code: "not_found", message: friendly(error?.message) ?? GENERIC.not_found };
    case "PGRST301":
    case "PGRST302":
      return { code: "unauthenticated", message: GENERIC.unauthenticated };
    default:
      return { code: "server", message: GENERIC.server };
  }
}

export function actionError(
  code: ActionErrorCode,
  message?: string,
  fieldErrors?: Record<string, string[]>,
): ActionError {
  return { code, message: message ?? GENERIC[code], ...(fieldErrors ? { fieldErrors } : {}) };
}

/** Thrown inside handlers to stop with a specific user-facing error. */
export class ActionFailure extends Error {
  constructor(public readonly error: ActionError) {
    super(error.message);
  }
}

/** Throws ActionFailure when a Supabase call returned an error. */
export function check<T>(result: { data: T; error: DbError | null }): T {
  if (result.error) throw new ActionFailure(mapDbError(result.error));
  return result.data;
}
