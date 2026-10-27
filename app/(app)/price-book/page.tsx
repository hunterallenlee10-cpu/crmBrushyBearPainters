import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { requireViewer } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { formatDate } from "@/lib/format/dates";
import { PriceBookForm } from "./price-book-form";

export const metadata: Metadata = { title: "Price Book" };

export default async function PriceBooksPage() {
  const viewer = await requireViewer();
  const canManage = viewer.can("catalog:manage") && !viewer.impersonating;
  const supabase = await createSupabaseServerClient();
  const { data: books, error } = await supabase
    .from("price_books")
    .select("id, name, description, is_default, active, updated_at, catalog_items(count)")
    .order("is_default", { ascending: false })
    .order("name")
    .limit(100);
  if (error) throw error;
  const list = books ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          The default price book feeds the estimate builder.
        </p>
        {canManage && <PriceBookForm />}
      </div>
      {list.length === 0 ? (
        <EmptyState icon={BookOpen} title="No price books yet">
          <p>An owner adds the first price book; the builder can still use custom lines.</p>
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((b) => {
            const count =
              (b.catalog_items as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
            return (
              <li key={b.id}>
                <Link
                  href={`/price-book/${b.id}`}
                  className="flex h-full flex-col gap-1 rounded-2xl border bg-card p-4 hover:border-bb-forest"
                >
                  <span className="flex flex-wrap items-center gap-2 font-semibold">
                    {b.name}
                    {b.is_default && <Badge variant="success">Default</Badge>}
                    {!b.active && <Badge variant="neutral">Inactive</Badge>}
                  </span>
                  {b.description && (
                    <span className="text-sm text-muted-foreground">{b.description}</span>
                  )}
                  <span className="mt-auto text-xs text-muted-foreground">
                    {count} items · updated {formatDate(b.updated_at)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
