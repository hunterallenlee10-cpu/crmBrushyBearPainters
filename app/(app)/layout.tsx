import { AppShell } from "@/components/shell/app-shell";
import { OfflineSyncProvider } from "@/components/offline/offline-sync";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <OfflineSyncProvider>
      <AppShell>{children}</AppShell>
    </OfflineSyncProvider>
  );
}
