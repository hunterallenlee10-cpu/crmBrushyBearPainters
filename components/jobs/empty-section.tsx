import { type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";

/**
 * Empty or locked state for a Job Detail section (SPEC §8.5): friendly, and
 * points to what to do next.
 */
export function EmptySection({
  icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState icon={icon} title={title} action={action}>
      {children}
    </EmptyState>
  );
}
