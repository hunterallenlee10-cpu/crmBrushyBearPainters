import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlaceholderPage } from "@/components/layout/placeholder-page";
import { allPages, canSeeLink, findPage } from "@/lib/nav";
import { requireViewer } from "@/lib/auth/viewer";

/**
 * Placeholder for every nav route that hasn't been built yet. Real pages added
 * at a specific path (e.g. app/(app)/leads/page.tsx) take precedence over this
 * catch-all automatically. Unknown paths 404.
 */

type Params = { slug: string[] };

export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  return allPages().map((p) => ({ slug: p.href.slice(1).split("/") }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const page = findPage(`/${slug.join("/")}`);
  return { title: page?.label ?? "Not found" };
}

export default async function NavPlaceholder({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = findPage(`/${slug.join("/")}`);
  if (!page) notFound();
  const viewer = await requireViewer();
  if (!canSeeLink(page, (p) => viewer.can(p))) notFound();
  return <PlaceholderPage page={page} />;
}
