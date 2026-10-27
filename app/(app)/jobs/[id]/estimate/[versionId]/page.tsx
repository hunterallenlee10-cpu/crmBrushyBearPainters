import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageContainer } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { EstimateBuilder } from "./builder";
import { loadBuilderData } from "./data";

type Params = Promise<{ id: string; versionId: string }>;

export const metadata: Metadata = { title: "Estimate Builder" };

/** Job → Estimate & Scope → one estimate version (SPEC §7, §8.5 #4). */
export default async function EstimateBuilderPage({ params }: { params: Params }) {
  const viewer = await requirePermission("estimates:read");
  const { id, versionId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(versionId).success) notFound();
  const supabase = await createSupabaseServerClient();
  const data = await loadBuilderData(supabase, viewer, id, versionId);
  if (!data) notFound();
  return (
    <PageContainer>
      <EstimateBuilder data={data} />
    </PageContainer>
  );
}
