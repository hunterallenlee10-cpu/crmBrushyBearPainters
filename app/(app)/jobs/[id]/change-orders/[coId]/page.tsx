import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageContainer } from "@/components/layout/page-header";
import { requirePermission } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { loadChangeOrderData } from "./data";
import { ChangeOrderEditor } from "./editor";

type Params = Promise<{ id: string; coId: string }>;

export const metadata: Metadata = { title: "Change Order" };

export default async function ChangeOrderPage({ params }: { params: Params }) {
  const viewer = await requirePermission("estimates:read");
  const { id, coId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(coId).success) notFound();
  const supabase = await createSupabaseServerClient();
  const data = await loadChangeOrderData(supabase, viewer, id, coId);
  if (!data) notFound();
  return (
    <PageContainer>
      <ChangeOrderEditor data={data} />
    </PageContainer>
  );
}
