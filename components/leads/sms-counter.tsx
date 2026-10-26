"use client";

import { countSms, describeSmsCount } from "@/lib/leads/messaging";
import { cn } from "@/lib/utils";

/** Live "42 / 160 · 1 text" counter under the SMS composer (SPEC §8.4). */
export function SmsCounter({ text, id }: { text: string; id?: string }) {
  const count = countSms(text);
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn(
        "text-xs tabular-nums",
        count.segments > 1 ? "text-warning" : "text-muted-foreground",
      )}
    >
      {describeSmsCount(count)}
    </p>
  );
}
