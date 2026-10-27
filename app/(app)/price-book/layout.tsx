import { notFound } from "next/navigation";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requireViewer } from "@/lib/auth/viewer";
import { SAMPLE_BADGE } from "@/lib/estimating/engine";
import { PriceBookTabs } from "./tabs";

/** Price Book (SPEC §8.12): catalog, paint products and production rates. */
export default async function PriceBookLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  if (!viewer.can("estimates:read") && !viewer.can("catalog:manage")) notFound();
  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Price Book"
        description={`What the estimate builder prices from. Seeded numbers are marked “${SAMPLE_BADGE}”; saving a row makes it yours.`}
      />
      <PriceBookTabs />
      {children}
    </PageContainer>
  );
}
