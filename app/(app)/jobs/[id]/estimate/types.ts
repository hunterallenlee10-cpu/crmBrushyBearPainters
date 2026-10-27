import type { Unit } from "@/lib/estimating/engine";

/** Shapes shared by the Estimate Builder, the change-order editor and their dialogs. */

export type BuilderIssue = { severity: "error" | "warning"; message: string };

export type BuilderLine = {
  id: string;
  optionId: string | null;
  areaId: string | null;
  isOptional: boolean;
  kind: "production_rate" | "flat";
  name: string;
  unit: Unit;
  surface: string | null;
  catalogCode: string | null;
  quantity: number;
  sides: number;
  condition: string;
  prepLevel: string;
  coats: number;
  primer: string;
  colorChange: string;
  method: string;
  access: string;
  height: string;
  sheen: string | null;
  productId: string | null;
  primerProductId: string | null;
  leadSafe: boolean;
  taxable: boolean;
  isRepairAllowance: boolean;
  unitPriceCents: number | null;
  unitCostCents: number | null;
  overridePriceCents: number | null;
  overrideReason: string | null;
  customerNote: string | null;
  laborHours: number | null;
  gallons: number | null;
  primerGallons: number | null;
  costCents: number | null;
  computedPriceCents: number | null;
  priceCents: number | null;
  description: string;
  issues: BuilderIssue[];
};

export type ProductChoice = {
  id: string;
  label: string;
  use: string;
  sheens: string[];
  isPrimer: boolean;
  isSample: boolean;
};

export type MeasureSettings = {
  doorDeductionSqft: number;
  windowDeductionSqft: number;
  gableFactor: number;
};
