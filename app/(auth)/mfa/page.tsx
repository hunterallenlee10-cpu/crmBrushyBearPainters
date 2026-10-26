import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BrandPage } from "@/components/shell/brand-card";
import { getViewerState } from "@/lib/auth/viewer";
import { MfaPanel } from "./mfa-panel";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function MfaPage() {
  const state = await getViewerState();
  if (state.status === "ok") redirect("/");
  if (state.status === "signed_out") redirect("/login");
  if (state.status === "no_access") redirect("/no-access");
  if (state.status === "not_configured") redirect("/setup-required");

  return (
    <BrandPage>
      <h1 className="font-display text-2xl text-bb-forest">Two-step sign-in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {state.access.mfa.required ? (
          <>
            Your role ({state.access.user.role.name}) can see money and settings, so it needs a code
            from your phone.
          </>
        ) : (
          <>You turned on two-step sign-in. Enter the code from your authenticator app.</>
        )}
      </p>
      <MfaPanel />
      <form action="/auth/signout" method="post" className="mt-4 text-center">
        <Button type="submit" variant="link" size="sm">
          Sign out
        </Button>
      </form>
    </BrandPage>
  );
}
