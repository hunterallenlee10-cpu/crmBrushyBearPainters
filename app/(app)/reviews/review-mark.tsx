"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/forms/native-select";
import { useRunAction } from "@/components/forms/use-run-action";
import { markReview } from "@/app/(app)/referrals/actions";

/** Mark that the customer left a review (and the stars), or undo it. */
export function ReviewMark({
  id,
  reviewLeft,
  rating,
  label,
  readOnly,
}: {
  id: string;
  reviewLeft: boolean;
  rating: number | null;
  label: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  const [stars, setStars] = React.useState(rating ? String(rating) : "5");
  if (reviewLeft) {
    return (
      <span className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-0.5 text-sm"
          aria-label={`${rating ?? "No"} stars`}
        >
          <Star className="size-3.5 fill-bb-honey text-bb-honey" aria-hidden /> {rating ?? "—"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending || readOnly}
          onClick={() =>
            run(() => markReview({ id, reviewLeft: false }), {
              success: "Review mark removed.",
              onOk: () => router.refresh(),
            })
          }
        >
          Undo
        </Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2" role="group" aria-label={`Review left: ${label}`}>
      <NativeSelect
        aria-label={`${label}: stars`}
        value={stars}
        onChange={(e) => setStars(e.target.value)}
        className="h-8 w-20 text-xs"
        disabled={pending || readOnly}
      >
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>
            {n} ★
          </option>
        ))}
      </NativeSelect>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || readOnly}
        onClick={() =>
          run(() => markReview({ id, reviewLeft: true, rating: Number(stars) }), {
            success: "Marked as reviewed.",
            onOk: () => router.refresh(),
          })
        }
      >
        Review left
      </Button>
    </span>
  );
}
