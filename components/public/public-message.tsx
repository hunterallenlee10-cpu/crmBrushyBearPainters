/** A plain customer-facing page body (public links: no login, no app shell). */
export function PublicMessage({
  title,
  companyName,
  children,
}: {
  title: string;
  companyName: string | null;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-4 py-10">
      <p className="text-sm font-semibold text-bb-forest">
        {companyName ?? "Brushy Bear Painters"}
      </p>
      <h1 className="text-2xl font-bold text-bb-ink">{title}</h1>
      <div className="flex flex-col gap-3 text-base text-muted-foreground">{children}</div>
    </main>
  );
}
