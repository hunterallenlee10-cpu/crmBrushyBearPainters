import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shell/logo";

export default function NotFound() {
  return (
    <main className="brand-surface flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo href={null} />
      <h1 className="font-display text-3xl text-bb-forest">Page not found</h1>
      <p className="max-w-sm text-sm text-bb-ink/80">
        That page doesn&apos;t exist. Check the link, or head back to the start.
      </p>
      <Button asChild variant="brand">
        <Link href="/">Go to Home</Link>
      </Button>
    </main>
  );
}
