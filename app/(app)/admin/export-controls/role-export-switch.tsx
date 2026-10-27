"use client";

import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { useRunAction } from "@/components/forms/use-run-action";
import { setRoleExport } from "./actions";

export function RoleExportSwitch({
  templateId,
  name,
  allowed,
}: {
  templateId: string;
  name: string;
  allowed: boolean;
}) {
  const router = useRouter();
  const { pending, run } = useRunAction();
  return (
    <Switch
      checked={allowed}
      disabled={pending}
      aria-label={`${name} can export`}
      onCheckedChange={(v) =>
        run(() => setRoleExport({ template_id: templateId, allowed: v }), {
          success: v ? `${name} can export.` : `${name} can no longer export.`,
          onOk: () => router.refresh(),
        })
      }
    />
  );
}
