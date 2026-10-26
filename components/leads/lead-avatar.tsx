import { cn } from "@/lib/utils";

/** Initials avatar for lead and contact headers. */
export function LeadAvatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-full border-[1.5px] border-bb-ink bg-bb-honey text-lg font-bold text-bb-ink",
        className,
      )}
    >
      {initials}
    </span>
  );
}
