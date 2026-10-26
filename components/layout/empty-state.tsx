import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Friendly empty state in the brand look (cream/forest, SPEC §16) that always
 * points to the next action.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "brand-surface flex flex-col items-center gap-3 rounded-2xl border border-bb-border px-6 py-12 text-center",
        className,
      )}
    >
      <span className="grid size-12 place-items-center rounded-2xl border-[1.5px] border-bb-ink bg-bb-honey text-bb-ink">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="font-display text-2xl text-bb-forest">{title}</h2>
      {children && <div className="max-w-md text-sm text-bb-ink/80">{children}</div>}
      {action}
    </div>
  );
}
