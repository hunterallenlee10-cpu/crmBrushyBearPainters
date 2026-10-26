import Link from "next/link";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { type StatusTone } from "@/lib/design/tokens";

const chipTone: Record<StatusTone | "brand", string> = {
  brand: "bg-accent text-bb-forest",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-neutral-bg text-neutral",
};

/**
 * KPI card (SPEC §8 global patterns): label, big number, colored icon chip and
 * a formula caption so every number explains itself. Values must come from
 * the metrics registry (Phase 9); this component only renders them.
 */
export function KpiCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = "brand",
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Formula caption, e.g. "38 open estimates × $6.2k avg · rolling 90d". */
  caption: string;
  icon: LucideIcon;
  tone?: StatusTone | "brand";
  /** Drill-down to the filtered list. */
  href?: string;
  className?: string;
}) {
  const body = (
    <div
      className={cn(
        "flex h-full flex-col gap-2 rounded-2xl border bg-card p-4 transition-colors",
        href && "hover:border-bb-forest/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", chipTone[tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="text-2xl font-bold tracking-tight text-bb-ink tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block rounded-2xl">
      {body}
    </Link>
  );
}
