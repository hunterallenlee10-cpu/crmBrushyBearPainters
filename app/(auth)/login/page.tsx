import type { Metadata } from "next";
import { BrandPage } from "@/components/shell/brand-card";
import { loginRedirectPath } from "@/lib/auth/paths";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/** Brand login screen (SPEC §16). Invite-only (SPEC §4.3). */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <BrandPage showMascot>
      <h1 className="font-display text-2xl text-bb-forest">Sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        For the Brushy Bear team. Ask an owner for an invite.
      </p>
      <LoginForm next={loginRedirectPath(next)} error={error ?? null} />
    </BrandPage>
  );
}
