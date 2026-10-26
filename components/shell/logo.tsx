import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Placeholder logo: wordmark in Lilita One plus a monogram tile. Swap in the
 * real logo/mascot files from public/brand/ when the owners provide them
 * (SPEC §16: don't generate new mascot art).
 */
export function Logo({
  className,
  size = "md",
  href = "/",
  tone = "forest",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  href?: string | null;
  tone?: "forest" | "light";
}) {
  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden
        className={cn(
          "grid place-items-center rounded-lg border-[1.5px] border-bb-ink bg-bb-honey font-display leading-none text-bb-ink",
          size === "sm" && "size-7 text-sm",
          size === "md" && "size-8 text-base",
          size === "lg" && "size-14 text-2xl",
        )}
      >
        BB
      </span>
      <span
        className={cn(
          "font-display leading-none tracking-wide",
          tone === "forest" ? "text-bb-forest" : "text-white",
          size === "sm" && "text-base",
          size === "md" && "text-lg",
          size === "lg" && "text-3xl",
        )}
      >
        Brushy Bear
      </span>
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} aria-label="Brushy Bear CRM home" className="rounded-md">
      {content}
    </Link>
  );
}
