import { PageContainer } from "@/components/layout/page-header";

export default function SectionLayout({ children }: { children: React.ReactNode }) {
  return <PageContainer>{children}</PageContainer>;
}
