import { Lock, ShieldCheck, HardHat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type PackView, type TemplateView } from "../model";

export function TemplateBadges({
  template,
}: {
  template: Pick<TemplateView, "isSystem" | "grantsAll" | "requiresMfa" | "isCrew">;
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <Badge variant={template.isSystem ? "neutral" : "info"}>
        {template.isSystem ? "System" : "Custom"}
      </Badge>
      {template.grantsAll && (
        <Badge variant="sample">
          <Lock aria-hidden /> Locked
        </Badge>
      )}
      {template.requiresMfa && (
        <Badge variant="warning">
          <ShieldCheck aria-hidden /> MFA required
        </Badge>
      )}
      {template.isCrew && (
        <Badge variant="success">
          <HardHat aria-hidden /> Crew
        </Badge>
      )}
    </span>
  );
}

export function PackBadge({ pack }: { pack: Pick<PackView, "isSystem"> }) {
  return pack.isSystem ? (
    <Badge variant="neutral">
      <Lock aria-hidden /> System · read-only
    </Badge>
  ) : (
    <Badge variant="info">Custom</Badge>
  );
}
