import { cn } from "@/lib/utils";

/** The explainable lead score: each factor with its +/− points (SPEC §6.6). */
export function ScoreFactors({ factors }: { factors: { label: string; points: number }[] }) {
  if (factors.length === 0) {
    return <p className="text-sm text-muted-foreground">No factors applied. Score starts at 50.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      <li className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">
        <span>Starting score</span>
        <span className="tabular-nums">50</span>
      </li>
      {factors.map((f) => (
        <li key={f.label} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span>{f.label}</span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              f.points > 0
                ? "text-success"
                : f.points < 0
                  ? "text-danger"
                  : "text-muted-foreground",
            )}
          >
            {f.points > 0 ? `+${f.points}` : f.points < 0 ? `−${Math.abs(f.points)}` : "0"}
          </span>
        </li>
      ))}
    </ul>
  );
}
