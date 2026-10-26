import { NextResponse } from "next/server";

/** Liveness check for uptime monitors and CI. Returns no configuration details. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
