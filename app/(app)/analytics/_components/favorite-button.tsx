"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toggleFavorite } from "../actions";

/** Star a dashboard or report (favorites are personal). */
export function FavoriteButton({
  itemType,
  itemKey,
  on,
  name,
  disabled,
}: {
  itemType: "dashboard" | "report";
  itemKey: string;
  on: boolean;
  name: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = React.useState(on);
  const [pending, startTransition] = React.useTransition();
  React.useEffect(() => setState(on), [on]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={pending || disabled}
      aria-pressed={state}
      aria-label={state ? `Remove ${name} from favorites` : `Add ${name} to favorites`}
      onClick={() => {
        const next = !state;
        setState(next);
        startTransition(async () => {
          const res = await toggleFavorite({ item_type: itemType, item_key: itemKey, on: next });
          if (!res.ok) {
            setState(!next);
            toast.error(res.error.message);
            return;
          }
          router.refresh();
        });
      }}
    >
      <Star
        className={cn("size-4", state ? "fill-bb-honey text-bb-ink" : "text-muted-foreground")}
        aria-hidden
      />
    </Button>
  );
}
