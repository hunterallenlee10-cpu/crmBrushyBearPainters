import { type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";

/**
 * Placeholder for a Job Detail section whose module arrives in a later phase
 * (SPEC §8.5). Friendly, names the phase, and points to what to do today.
 */
export function EmptySection({
  icon,
  title,
  phase,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  /** Build phase that brings this section's real content. */
  phase?: number;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState icon={icon} title={title} action={action}>
      {phase !== undefined && (
        <p className="mb-2 font-semibold text-bb-forest">Arrives in Phase {phase}</p>
      )}
      {children}
    </EmptyState>
  );
}
