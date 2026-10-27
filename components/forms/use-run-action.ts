"use client";

import * as React from "react";
import { toast } from "sonner";
import type { ActionError, ActionResult } from "@/lib/actions/errors";

/** First message per field, for showing next to inputs. */
export function firstErrors(error: ActionError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(error.fieldErrors ?? {})) {
    if (v[0]) out[k] = v[0];
  }
  return out;
}

/**
 * Runs a Server Action in a transition: toasts the outcome, hands back field
 * errors, and keeps a pending flag for disabling buttons.
 */
export function useRunAction() {
  const [pending, startTransition] = React.useTransition();
  const run = React.useCallback(
    <T>(
      call: () => Promise<ActionResult<T>>,
      opts: {
        success?: string | ((data: T) => string);
        onOk?: (data: T) => void;
        onError?: (error: ActionError) => void;
      } = {},
    ) => {
      startTransition(async () => {
        const r = await call();
        if (r.ok) {
          const msg = typeof opts.success === "function" ? opts.success(r.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onOk?.(r.data);
        } else {
          toast.error(r.error.message);
          opts.onError?.(r.error);
        }
      });
    },
    [],
  );
  return { pending, run };
}
