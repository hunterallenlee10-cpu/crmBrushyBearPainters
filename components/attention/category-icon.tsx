import {
  BadgeCheck,
  CalendarClock,
  ClipboardList,
  DollarSign,
  FileText,
  HardHat,
  HeartHandshake,
  MessageSquare,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_LABELS, type AttentionCategory } from "@/lib/domain/attention/rules";
import { cn } from "@/lib/utils";

const ICONS: Record<AttentionCategory, LucideIcon> = {
  communication: MessageSquare,
  tasks: ClipboardList,
  scheduling: CalendarClock,
  sales: Tag,
  approvals: BadgeCheck,
  financial: DollarSign,
  production: HardHat,
  qa: ShieldCheck,
  customer: HeartHandshake,
  documents: FileText,
};

const TONE: Record<AttentionCategory, string> = {
  communication: "bg-info-bg text-info",
  tasks: "bg-accent text-bb-forest",
  scheduling: "bg-warning-bg text-warning",
  sales: "bg-success-bg text-success",
  approvals: "bg-accent text-bb-forest",
  financial: "bg-success-bg text-success",
  production: "bg-neutral-bg text-neutral",
  qa: "bg-danger-bg text-danger",
  customer: "bg-info-bg text-info",
  documents: "bg-neutral-bg text-neutral",
};

/** Rounded-square icon chip for an attention category, named for screen readers. */
export function AttentionCategoryIcon({
  category,
  className,
}: {
  category: AttentionCategory;
  className?: string;
}) {
  const Icon = ICONS[category];
  const label = CATEGORY_LABELS[category];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-lg",
        TONE[category],
        className,
      )}
    >
      <Icon className="size-4" aria-hidden />
    </span>
  );
}
