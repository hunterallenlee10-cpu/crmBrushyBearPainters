import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandPage } from "@/components/shell/brand-card";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Setup required" };

/** Shown when the server has no Supabase settings (fresh checkout, misconfigured deploy). */
export default function SetupRequiredPage() {
  if (isSupabaseConfigured()) redirect("/");
  return (
    <BrandPage>
      <h1 className="font-display text-2xl text-bb-forest">Almost there</h1>
      <p className="mt-2 text-sm text-bb-ink/80">
        This server isn&apos;t connected to its database yet.
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
        <li>
          Run <code className="rounded bg-muted px-1">pnpm supabase start</code>.
        </li>
        <li>
          Copy the Project URL, Publishable key and Secret key into{" "}
          <code className="rounded bg-muted px-1">.env.local</code> (see <code>.env.example</code>).
        </li>
        <li>Restart the dev server.</li>
      </ol>
    </BrandPage>
  );
}
