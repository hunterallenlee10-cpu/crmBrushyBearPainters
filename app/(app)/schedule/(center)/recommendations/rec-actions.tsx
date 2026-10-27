"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunAction } from "@/components/forms/use-run-action";
import {
  approveRecommendation,
  refreshRecommendations,
  rejectRecommendation,
  undoRecommendation,
} from "../../actions";

export function RecActions({
  id,
  status,
  undoUntil,
}: {
  id: string;
  status: string;
  undoUntil: string | null;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  if (status === "pending") {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => approveRecommendation({ id }), {
              success: "Approved: a draft is on the Master Schedule. Publish it when you're ready.",
              onOk: () => router.refresh(),
            })
          }
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => rejectRecommendation({ id }), {
              success: "Rejected.",
              onOk: () => router.refresh(),
            })
          }
        >
          Reject
        </Button>
      </div>
    );
  }
  if (status === "approved" && undoUntil && new Date(undoUntil).getTime() > now) {
    const mins = Math.max(1, Math.ceil((new Date(undoUntil).getTime() - now) / 60_000));
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          run(() => undoRecommendation({ id }), {
            success: "Undone.",
            onOk: () => router.refresh(),
          })
        }
      >
        <Undo2 aria-hidden /> Undo ({mins} min left)
      </Button>
    );
  }
  return null;
}

export function RefreshButton() {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        run(() => refreshRecommendations({}), {
          success: (r) =>
            r.created
              ? `${r.created} new recommendation${r.created === 1 ? "" : "s"}.`
              : "No new recommendations.",
          onOk: () => router.refresh(),
        })
      }
    >
      <RefreshCw aria-hidden /> Refresh recommendations
    </Button>
  );
}
