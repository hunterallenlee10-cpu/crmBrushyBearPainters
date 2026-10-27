import { addDays, formatDay, type IsoDate } from "./dates";

/**
 * Subcontractor compliance (SPEC §5.4, §13.4, §9 "Sub compliance expiring"):
 * WA L&I registration, insurance (COI), W-9, bond and RRP certification. The
 * status matches app.subcontractor_status() in the database. Pure.
 */

export type SubcontractorPaperwork = {
  status: string;
  lniExpiresOn: IsoDate | null;
  coiExpiresOn: IsoDate | null;
  bondExpiresOn: IsoDate | null;
  rrpExpiresOn: IsoDate | null;
  w9OnFile: boolean;
};

export type ComplianceIssue = {
  kind: "lni" | "coi" | "w9" | "bond" | "rrp";
  /** expired: past its date or missing; expiring: within the window. */
  level: "expired" | "expiring";
  message: string;
  expiresOn: IsoDate | null;
};

const LABELS = {
  lni: "L&I registration",
  coi: "Insurance (COI)",
  w9: "W-9",
  bond: "Bond",
  rrp: "RRP certification",
} as const;

export function subcontractorStatus(
  s: SubcontractorPaperwork,
  today: IsoDate,
): "active" | "expiring" | "suspended" {
  if (s.status === "suspended") return "suspended";
  const soon = addDays(today, 30);
  const dates = [s.lniExpiresOn, s.coiExpiresOn, s.bondExpiresOn, s.rrpExpiresOn].filter(
    (d): d is IsoDate => d !== null,
  );
  if (dates.some((d) => d <= soon) || !s.lniExpiresOn || !s.coiExpiresOn || !s.w9OnFile) {
    return "expiring";
  }
  return "active";
}

/** What needs renewing within `windowDays` (missing required paperwork counts as expired). */
export function complianceIssues(
  s: SubcontractorPaperwork,
  today: IsoDate,
  windowDays = 30,
): ComplianceIssue[] {
  const out: ComplianceIssue[] = [];
  const soon = addDays(today, windowDays);
  const check = (kind: "lni" | "coi" | "bond" | "rrp", date: IsoDate | null, required: boolean) => {
    if (!date) {
      if (required)
        out.push({
          kind,
          level: "expired",
          message: `${LABELS[kind]} not on file.`,
          expiresOn: null,
        });
      return;
    }
    if (date < today)
      out.push({
        kind,
        level: "expired",
        message: `${LABELS[kind]} expired ${formatDay(date)}.`,
        expiresOn: date,
      });
    else if (date <= soon)
      out.push({
        kind,
        level: "expiring",
        message: `${LABELS[kind]} expires ${formatDay(date)}.`,
        expiresOn: date,
      });
  };
  check("lni", s.lniExpiresOn, true);
  check("coi", s.coiExpiresOn, true);
  check("bond", s.bondExpiresOn, false);
  check("rrp", s.rrpExpiresOn, false);
  if (!s.w9OnFile)
    out.push({ kind: "w9", level: "expired", message: "No W-9 on file.", expiresOn: null });
  return out;
}

export const COMPLIANCE_LABELS = LABELS;
