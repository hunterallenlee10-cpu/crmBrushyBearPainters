import { GradeBadge } from "@/components/leads/lead-badges";
import { TEMPERATURE_LABELS, type Grade, type Temperature } from "@/lib/domain/leads/constants";

/** Grade badge + "72/100 · Warm Lead" (SPEC §6.6). */
export function ScoreSummary({
  grade,
  score,
  temperature,
}: {
  grade: Grade | null;
  score: number | null;
  temperature: Temperature | null;
}) {
  if (!grade || score === null) {
    return <span className="text-sm text-muted-foreground">Not scored yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <GradeBadge grade={grade} score={score} />
      <span className="whitespace-nowrap text-muted-foreground">
        {score}/100{temperature ? ` · ${TEMPERATURE_LABELS[temperature]} Lead` : ""}
      </span>
    </span>
  );
}
