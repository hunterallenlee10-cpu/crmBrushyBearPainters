import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getViewerState } from "@/lib/auth/viewer";
import { createSupabaseServerClient } from "@/lib/db/server";
import { createSupabaseServiceClient } from "@/lib/db/service";
import { logError } from "@/lib/log";
import { pdfHeaders } from "@/lib/pdf/render";
import type { Permission } from "@/lib/permissions";
import type { RenderedPdf } from "./pdfs";

type UserDb = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type ServiceDb = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const notFound = () => new NextResponse("Not found", { status: 404 });

/**
 * One pattern for the office PDF routes: signed in, holds the permission, and
 * can see the record with their own client (row security); then the service
 * client renders or fetches the file. Unknown and hidden records are both 404.
 */
export async function servePdf(opts: {
  name: string;
  ids: readonly string[];
  permission: Permission;
  visible: (db: UserDb) => Promise<boolean>;
  render: (service: ServiceDb) => Promise<RenderedPdf | null>;
  disposition?: "inline" | "attachment";
}): Promise<NextResponse> {
  if (!opts.ids.every((id) => z.uuid().safeParse(id).success)) return notFound();
  const state = await getViewerState();
  if (state.status !== "ok") return new NextResponse("Sign in first", { status: 401 });
  if (!state.viewer.can(opts.permission)) return notFound();
  const supabase = await createSupabaseServerClient();
  if (!(await opts.visible(supabase))) return notFound();
  try {
    const service = await createSupabaseServiceClient({ actorId: state.viewer.id });
    const pdf = await opts.render(service);
    if (!pdf) return notFound();
    return new NextResponse(new Uint8Array(pdf.bytes), {
      headers: pdfHeaders(pdf.fileName, opts.disposition ?? "inline"),
    });
  } catch (e) {
    logError(`pdf:${opts.name}`, e);
    return new NextResponse("We couldn't build that PDF. Try again.", { status: 500 });
  }
}
