import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BrandPage } from "@/components/shell/brand-card";
import { getViewerState } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  const state = await getViewerState();
  if (state.status === "ok") redirect("/");
  if (state.status === "mfa") redirect("/mfa");
  if (state.status === "signed_out") redirect("/login");
  const email = state.status === "no_access" ? state.email : null;

  return (
    <BrandPage>
      <h1 className="font-display text-2xl text-bb-forest">No access yet</h1>
      <p className="mt-2 text-sm text-bb-ink/80">
        {email ? (
          <>
            You&apos;re signed in as <span className="font-semibold">{email}</span>, but that
            account isn&apos;t set up for Brushy Bear CRM or has been turned off.
          </>
        ) : (
          <>This account isn&apos;t set up for Brushy Bear CRM or has been turned off.</>
        )}
      </p>
      <p className="mt-2 text-sm text-bb-ink/80">
        Ask an owner to invite you or turn your account back on.
      </p>
      <form action="/auth/signout" method="post" className="mt-6">
        <Button type="submit" variant="outline" className="w-full">
          Sign out
        </Button>
      </form>
    </BrandPage>
  );
}
