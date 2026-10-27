import type { Metadata } from "next";
import { CloudOff } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";

export const metadata: Metadata = { title: "Offline" };
export const dynamic = "force-static";

/**
 * Shown by the service worker when a page can't load without a connection
 * (SPEC §2 PWA). Photos already taken keep waiting on the device.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg items-center px-4">
      <EmptyState icon={CloudOff} title="You're offline">
        <p>
          This page needs a connection. Photos you already took are saved on this device and upload
          on their own when you&apos;re back online. Go back to the job you had open to keep taking
          photos.
        </p>
      </EmptyState>
    </main>
  );
}
