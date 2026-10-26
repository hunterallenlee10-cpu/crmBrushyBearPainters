import { getStage, type JobStageId } from "@/lib/domain/stages";
import { cn } from "@/lib/utils";

type StageStyle = React.CSSProperties & { "--stage-color": string };

/** One consistent color per job stage (SPEC §16). */
export function StageBadge({ stage, className }: { stage: JobStageId; className?: string }) {
  const s = getStage(stage);
  const style: StageStyle = { "--stage-color": s.color };
  return (
    <span
      style={style}
      className={cn(
        "stage-badge inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        className,
      )}
    >
      <span className="stage-dot size-1.5 rounded-full" aria-hidden />
      {s.label}
    </span>
  );
}
