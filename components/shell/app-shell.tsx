import { Logo } from "@/components/shell/logo";
import { TopNav } from "@/components/shell/top-nav";
import { MobileMenu } from "@/components/shell/mobile-menu";
import { SearchProvider, SearchTrigger } from "@/components/shell/search";
import {
  IntegrationsPill,
  NotificationsMenu,
  SoftphoneButton,
  UserMenu,
} from "@/components/shell/top-bar-actions";
import { ViewAsBanner, ViewAsButton, type ViewAsUser } from "@/components/shell/view-as";
import { HelpButton } from "@/components/shell/help-button";
import { CrewTabBar } from "@/components/shell/crew-tab-bar";
import { requireViewer } from "@/lib/auth/viewer";
import { initials } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/db/server";
import { INTEGRATION_COUNT } from "@/lib/integrations/registry";
import { visibleNav } from "@/lib/nav";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  const supabase = await createSupabaseServerClient();
  const groups = visibleNav((p) => viewer.can(p));
  const canViewAs = viewer.isOwner && !viewer.impersonating;
  const attentionCount = 0; // Attention engine arrives in Phase 3.

  const [summary, people] = await Promise.all([
    viewer.can("integrations:read") ? supabase.rpc("integration_summary") : Promise.resolve(null),
    canViewAs
      ? supabase
          .from("profiles")
          .select("id, full_name, role_templates(name)")
          .eq("is_active", true)
          .neq("id", viewer.real.id)
          .order("full_name")
      : Promise.resolve(null),
  ]);

  const counts = (summary?.data ?? null) as { connected?: number; total?: number } | null;
  const viewAsUsers: ViewAsUser[] = (people?.data ?? []).map((p) => ({
    id: p.id,
    name: p.full_name,
    role: p.role_templates?.name ?? "",
  }));

  return (
    <SearchProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {viewer.impersonating && <ViewAsBanner name={viewer.name} role={viewer.role.name} />}
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:px-4">
          <MobileMenu groups={groups} attentionCount={attentionCount} />
          <Logo size="sm" className="mr-2" />
          <TopNav groups={groups} attentionCount={attentionCount} />
          <div className="ml-auto flex items-center gap-1">
            <div className="hidden md:block">
              <SearchTrigger />
            </div>
            <div className="md:hidden">
              <SearchTrigger compact />
            </div>
            {counts && (
              <IntegrationsPill
                connected={counts.connected ?? 0}
                total={counts.total ?? INTEGRATION_COUNT}
              />
            )}
            {viewer.can("messages:send") && <SoftphoneButton />}
            {canViewAs && <ViewAsButton users={viewAsUsers} />}
            <NotificationsMenu unread={0} />
            <UserMenu
              name={viewer.real.fullName}
              email={viewer.real.email}
              initials={initials(viewer.real.fullName)}
              roleLabel={viewer.real.role.name}
            />
          </div>
        </div>
      </header>
      <main id="main" className={viewer.isCrew ? "pb-20 lg:pb-0" : undefined}>
        {children}
      </main>
      <HelpButton aiConnected={false} />
      {viewer.isCrew && <CrewTabBar />}
    </SearchProvider>
  );
}
