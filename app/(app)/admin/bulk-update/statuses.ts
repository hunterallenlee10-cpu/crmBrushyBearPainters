/** Bulk update status badges. */
export const BULK_STATUS: Record<
  string,
  { label: string; variant: "info" | "success" | "warning" | "neutral" }
> = {
  preview: { label: "Preview — not applied", variant: "info" },
  applied: { label: "Applied", variant: "success" },
  reverted: { label: "Reverted", variant: "warning" },
  canceled: { label: "Canceled", variant: "neutral" },
};
