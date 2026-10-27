import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { requireViewer } from "@/lib/auth/viewer";
import { parseReleaseNotes } from "@/lib/domain/help/release-notes";

export const metadata: Metadata = { title: "Release Notes" };

/** Release notes (SPEC §8.17), one entry per build phase, from CHANGELOG.md. */
export default async function ReleaseNotesPage() {
  await requireViewer();
  let notes: ReturnType<typeof parseReleaseNotes> = [];
  try {
    notes = parseReleaseNotes(await readFile(join(process.cwd(), "CHANGELOG.md"), "utf8"));
  } catch {
    notes = [];
  }
  return (
    <PageContainer className="flex max-w-4xl flex-col gap-5">
      <Link
        href="/help"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> Help Center
      </Link>
      <PageHeader title="Release Notes" description="What changed in the CRM, newest first." />
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Release notes aren&apos;t available right now.
        </p>
      ) : (
        notes.map((n) => (
          <section
            key={n.title}
            aria-labelledby={`rn-${n.phase ?? n.title}`}
            className="rounded-2xl border bg-card p-5"
          >
            <h2 id={`rn-${n.phase ?? n.title}`} className="text-lg font-semibold text-bb-ink">
              {n.title}
            </h2>
            {n.added.length > 0 && (
              <>
                <h3 className="mt-3 text-sm font-semibold">New</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {n.added.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </>
            )}
            {n.changed.length > 0 && (
              <>
                <h3 className="mt-3 text-sm font-semibold">Changed</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {n.changed.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))
      )}
    </PageContainer>
  );
}
