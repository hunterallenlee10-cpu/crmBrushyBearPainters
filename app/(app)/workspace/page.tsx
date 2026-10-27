import type { Metadata } from "next";
import { requireViewer } from "@/lib/auth/viewer";
import { MyDay } from "@/components/analytics/my-day";

export const metadata: Metadata = { title: "My Day" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Workspace "My Day" (SPEC §8.3), always available from the user menu. */
export default async function WorkspacePage({ searchParams }: { searchParams: SearchParams }) {
  const viewer = await requireViewer();
  return <MyDay viewer={viewer} params={await searchParams} />;
}
