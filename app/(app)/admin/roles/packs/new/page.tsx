import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/viewer";
import { PackEditor } from "../pack-editor";

export const metadata: Metadata = { title: "New permission pack" };

export default async function NewPackPage() {
  await requirePermission("roles:manage");
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/roles?tab=packs">
            <ArrowLeft aria-hidden /> Roles &amp; Permissions
          </Link>
        </Button>
      </div>
      <PageHeader
        title="New permission pack"
        description="A custom pack you can add to any template except Owner. Its key is set from the name."
      />
      <PackEditor mode="create" />
    </div>
  );
}
