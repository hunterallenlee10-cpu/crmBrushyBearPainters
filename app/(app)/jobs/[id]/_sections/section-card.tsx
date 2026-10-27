/** Small layout pieces shared by the Job Detail sections (server-safe, no hooks). */

function slug(title: string): string {
  return `job-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function Card({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = slug(title);
  return (
    <section
      aria-labelledby={headingId}
      className={`min-w-0 rounded-2xl border bg-card p-4 sm:p-5 ${className ?? ""}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Shown when the job can't be read (the page itself 404s first in practice). */
export function Unavailable() {
  return (
    <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
      This job isn&apos;t available.
    </p>
  );
}

/** A section the viewer's role can't see. */
export function NoAccess({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">{children}</p>;
}
