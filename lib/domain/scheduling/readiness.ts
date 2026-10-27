/**
 * Dispatch readiness % (SPEC §8.5 #3): city/territory match, skill match,
 * crew available, materials status, HOA/lead-safe status and (exterior and
 * deck, when weather is connected) the weather window. Checks that don't
 * apply, or whose data isn't connected, are left out of the percentage. Pure.
 */

export type ReadinessStatus = "pass" | "fail" | "unavailable";

export type ReadinessCheck = {
  key: "territory" | "skills" | "crew_available" | "materials" | "compliance" | "weather";
  label: string;
  status: ReadinessStatus;
  detail: string;
};

export type ReadinessInput = {
  crewName: string | null;
  /** The crew's home territory matches the job's (null: either is unknown). */
  territoryMatch: boolean | null;
  missingSkillLabels: readonly string[];
  /** Blocking date conflicts for the crew on the planned dates (time off, double-booking). */
  availabilityProblems: readonly string[];
  /** Live paint orders by status. */
  paintOrderStatuses: readonly string[];
  /** HOA / lead-safe onboarding items not cleared, and blocking holds. */
  complianceOpen: readonly string[];
  seasonal: boolean;
  weather: { connected: boolean; problems: readonly string[] };
};

const READY = new Set(["picked_up", "delivered"]);
const ORDERED = new Set(["ordered", "partially_received"]);

export function materialsStatus(
  statuses: readonly string[],
): "none" | "not_ordered" | "ordered" | "ready" {
  const live = statuses.filter((s) => s !== "canceled");
  if (!live.length) return "none";
  if (live.every((s) => READY.has(s))) return "ready";
  if (live.every((s) => READY.has(s) || ORDERED.has(s))) return "ordered";
  return "not_ordered";
}

export function dispatchReadiness(input: ReadinessInput): {
  percent: number | null;
  checks: ReadinessCheck[];
} {
  const checks: ReadinessCheck[] = [];
  const noCrew = !input.crewName;
  checks.push(
    noCrew
      ? {
          key: "territory",
          label: "City / territory match",
          status: "fail",
          detail: "No crew assigned yet.",
        }
      : input.territoryMatch === null
        ? {
            key: "territory",
            label: "City / territory match",
            status: "unavailable",
            detail: "The crew or the job has no territory.",
          }
        : {
            key: "territory",
            label: "City / territory match",
            status: input.territoryMatch ? "pass" : "fail",
            detail: input.territoryMatch
              ? `${input.crewName} works this territory.`
              : `${input.crewName}'s home territory is elsewhere.`,
          },
  );
  checks.push(
    noCrew
      ? { key: "skills", label: "Skill match", status: "fail", detail: "No crew assigned yet." }
      : input.missingSkillLabels.length
        ? {
            key: "skills",
            label: "Skill match",
            status: "fail",
            detail: `Missing: ${input.missingSkillLabels.join(", ")}.`,
          }
        : { key: "skills", label: "Skill match", status: "pass", detail: "Every skill covered." },
  );
  checks.push(
    noCrew
      ? {
          key: "crew_available",
          label: "Crew available",
          status: "fail",
          detail: "No crew assigned yet.",
        }
      : input.availabilityProblems.length
        ? {
            key: "crew_available",
            label: "Crew available",
            status: "fail",
            detail: input.availabilityProblems[0] ?? "Not available.",
          }
        : {
            key: "crew_available",
            label: "Crew available",
            status: "pass",
            detail: `${input.crewName} is free on the planned days.`,
          },
  );
  const m = materialsStatus(input.paintOrderStatuses);
  checks.push({
    key: "materials",
    label: "Materials",
    status: m === "ready" || m === "none" ? "pass" : m === "ordered" ? "fail" : "fail",
    detail:
      m === "ready"
        ? "Paint is picked up or delivered."
        : m === "none"
          ? "No paint order on this job."
          : m === "ordered"
            ? "Paint is ordered, not picked up or delivered yet."
            : "Paint isn't ordered yet.",
  });
  checks.push(
    input.complianceOpen.length
      ? {
          key: "compliance",
          label: "HOA / lead-safe",
          status: "fail",
          detail: `Open: ${input.complianceOpen.join(", ")}.`,
        }
      : { key: "compliance", label: "HOA / lead-safe", status: "pass", detail: "Nothing open." },
  );
  if (input.seasonal) {
    checks.push(
      !input.weather.connected
        ? {
            key: "weather",
            label: "Weather window",
            status: "unavailable",
            detail: "Weather not connected. Check the forecast yourself.",
          }
        : input.weather.problems.length
          ? {
              key: "weather",
              label: "Weather window",
              status: "fail",
              detail: input.weather.problems[0] ?? "Bad weather forecast.",
            }
          : {
              key: "weather",
              label: "Weather window",
              status: "pass",
              detail: "Dry forecast on the planned days.",
            },
    );
  }
  const counted = checks.filter((c) => c.status !== "unavailable");
  const percent = counted.length
    ? Math.round((counted.filter((c) => c.status === "pass").length / counted.length) * 100)
    : null;
  return { percent, checks };
}
