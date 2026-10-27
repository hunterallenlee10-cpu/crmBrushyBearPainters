import { PageContainer } from "@/components/layout/page-header";

// Remove once app/(app)/jobs/layout.tsx provides the page container for every jobs route.
export default function NewJobLayout({ children }: { children: React.ReactNode }) {
  return <PageContainer>{children}</PageContainer>;
}
