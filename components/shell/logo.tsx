import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Brushy Bear logo: the bear-head mark from the website plus the wordmark in
 * Lilita One (crisp at small sizes). Full wordmark image lives in public/brand/.
 */
export function Logo({
  className,
  size = "md",
  href = "/",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  href?: string | null;
}) {
  const px = size === "sm" ? 28 : size === "md" ? 32 : 56;
  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image
        src="/brand/logo-mark.png"
        alt=""
        width={px}
        height={px}
        priority
        className="rounded-lg"
      />
      <span
        className={cn(
          "font-display leading-none tracking-wide text-bb-forest",
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
