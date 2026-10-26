import Image from "next/image";

/** Cream brand page with the wordmark (login, MFA, no-access, setup pages; SPEC §16). */
export function BrandPage({
  children,
  showMascot = false,
}: {
  children: React.ReactNode;
  showMascot?: boolean;
}) {
  return (
    <main className="brand-surface flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {showMascot && (
            <Image
              src="/brand/mascot-roller.png"
              alt=""
              width={120}
              height={123}
              priority
              className="h-auto w-24 drop-shadow-sm"
            />
          )}
          <Image
            src="/brand/logo-wordmark.png"
            alt="Brushy Bear Painters"
            width={280}
            height={87}
            priority
            className="h-auto w-56"
          />
          <p className="text-sm text-bb-ink/80">
            Eastside house painting that holds up to the rain.
          </p>
        </div>
        <div className="rounded-2xl border border-bb-border bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
