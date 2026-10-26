import { cn } from "@/lib/utils";

/**
 * Card frame for a dashboard widget: title, formula caption and a slot for the
 * "View data" button (SPEC §8: every chart has one).
 */
export function ChartCard({
  title,
  caption,
  action,
  children,
  className,
  id,
}: {
  title: string;
  caption?: string;
  /** Usually a <ViewDataDialog>. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-4", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-bb-ink">
            {title}
          </h2>
          {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
        </div>
        {action}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

/** Quiet in-card empty state for a widget with nothing to show yet. */
export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="grid min-h-24 place-items-center rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
