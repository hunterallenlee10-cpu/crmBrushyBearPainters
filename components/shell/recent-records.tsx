"use client";

import * as React from "react";

/**
 * Recently opened records for universal search (per browser). Detail pages
 * render <RememberRecent …/>; nothing here is sensitive beyond a name the
 * user just looked at, and it never leaves their device.
 */

export type RecentRecord = {
  kind: "lead" | "account" | "contact";
  id: string;
  title: string;
  href: string;
};

const KEY = "bb:recent-records";
const MAX = 8;

export function readRecentRecords(): RecentRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentRecord =>
        typeof r === "object" &&
        r !== null &&
        ["lead", "account", "contact"].includes((r as RecentRecord).kind) &&
        typeof (r as RecentRecord).href === "string" &&
        (r as RecentRecord).href.startsWith("/") &&
        typeof (r as RecentRecord).title === "string",
    );
  } catch {
    return [];
  }
}

export function rememberRecentRecord(record: RecentRecord): void {
  try {
    const next = [record, ...readRecentRecords().filter((r) => r.href !== record.href)].slice(
      0,
      MAX,
    );
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked (private mode): recent records are a convenience only.
  }
}

export function RememberRecent(props: RecentRecord) {
  const { kind, id, title, href } = props;
  React.useEffect(() => {
    rememberRecentRecord({ kind, id, title, href });
  }, [kind, id, title, href]);
  return null;
}
