import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { HealthFactor } from "@/lib/domain/jobs/health";
import { cn } from "@/lib/utils";

/**
 * Job Health checks (SPEC §6.5): pass / fail / "arrives in Phase N", with the
 * recommendation under each failed check.
 */
export function HealthFactors({ factors }: { factors: HealthFactor[] }) {
  if (!factors.length) {
    return <p className="text-sm text-muted-foreground">No checks apply to this stage.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {factors.map((f) => (
        <li key={f.key} className="flex gap-2 text-sm">
          {f.status === "pass" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          ) : f.status === "fail" ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          ) : (
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0">
            <span className={cn(f.status === "unavailable" && "text-muted-foreground")}>
              {f.label}
            </span>
            <span className="sr-only">
              {f.status === "pass" ? ": passing" : f.status === "fail" ? ": needs action" : ""}
            </span>
            {f.status === "unavailable" && (
              <span className="text-xs text-muted-foreground">
                {" "}
                · arrives in Phase {f.arrivesInPhase}
              </span>
            )}
            {f.status === "fail" && f.recommendation && (
              <span className="block text-xs text-muted-foreground">{f.recommendation}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
