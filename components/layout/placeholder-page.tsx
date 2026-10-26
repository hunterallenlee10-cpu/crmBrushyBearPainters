import { Hammer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { type NavLink } from "@/lib/nav";

/** Shown on every route whose real screen hasn't been built yet. */
export function PlaceholderPage({ page }: { page: NavLink }) {
  return (
    <PageContainer className="flex flex-col gap-6">
      <PageHeader
        title={page.label}
        description={page.description}
        actions={<Badge variant="neutral">Arrives in Phase {page.phase}</Badge>}
      />
      <EmptyState icon={Hammer} title="Coming soon">
        <p>
          This screen is built in Phase {page.phase} of the plan. The navigation, search and layout
          around it are ready now.
        </p>
      </EmptyState>
    </PageContainer>
  );
}
