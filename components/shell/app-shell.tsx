import { Logo } from "@/components/shell/logo";
import { TopNav } from "@/components/shell/top-nav";
import { MobileMenu } from "@/components/shell/mobile-menu";
import { SearchProvider, SearchTrigger } from "@/components/shell/search";
import {
  IntegrationsPill,
  NotificationsMenu,
  SoftphoneButton,
  UserMenu,
  ViewAsUserButton,
} from "@/components/shell/top-bar-actions";
import { HelpButton } from "@/components/shell/help-button";
import { CrewTabBar } from "@/components/shell/crew-tab-bar";
import { getViewer, isCrewRole } from "@/lib/auth/viewer";
import { INTEGRATION_COUNT, connectedIntegrationCount } from "@/lib/integrations/registry";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const crew = isCrewRole(viewer.role);
  const showAdmin = viewer.role === "owner";
  const attentionCount = 0; // Attention engine arrives in Phase 3.

  return (
    <SearchProvider>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-card px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {viewer.isPreview && (
        <div className="bg-bb-forest-dark px-4 py-1.5 text-center text-xs text-white">
          Preview build · sign-in and real data arrive in Phase 1
        </div>
      )}
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:px-4">
          <MobileMenu showAdmin={showAdmin} attentionCount={attentionCount} />
          <Logo size="sm" className="mr-2" />
          <TopNav attentionCount={attentionCount} showAdmin={showAdmin} />
          <div className="ml-auto flex items-center gap-1">
            <div className="hidden md:block">
              <SearchTrigger />
            </div>
            <div className="md:hidden">
              <SearchTrigger compact />
            </div>
            <IntegrationsPill connected={connectedIntegrationCount()} total={INTEGRATION_COUNT} />
            <SoftphoneButton />
            {showAdmin && <ViewAsUserButton />}
            <NotificationsMenu unread={0} />
            <UserMenu
              name={viewer.name}
              initials={viewer.initials}
              roleLabel={viewer.roleLabel}
              isPreview={viewer.isPreview}
            />
          </div>
        </div>
      </header>
      <main id="main" className={crew ? "pb-20 lg:pb-0" : undefined}>
        {children}
      </main>
      <HelpButton aiConnected={false} />
      {crew && <CrewTabBar />}
    </SearchProvider>
  );
}
