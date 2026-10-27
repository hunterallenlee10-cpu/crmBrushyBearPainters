"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { confirmUnsubscribe } from "./actions";

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, setState] = React.useState<"idle" | "done" | string>("idle");
  const [pending, startTransition] = React.useTransition();
  if (state === "done") {
    return (
      <p role="status" className="font-medium text-bb-forest">
        You&apos;re unsubscribed. Sorry to see you go!
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        className="self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await confirmUnsubscribe({ token });
            setState(r.ok ? "done" : r.message);
          })
        }
      >
        Unsubscribe
      </Button>
      {state !== "idle" && (
        <p role="alert" className="text-sm text-danger">
          {state}
        </p>
      )}
    </div>
  );
}
