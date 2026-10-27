/**
 * Fixed choices for the Estimate & Scope Builder (SPEC §5.5, §7.2, §7.3).
 * Admin-editable values (multipliers, rates, prices) live in estimate_settings,
 * production_rates, paint_products and catalog_items, never here.
 */

export const CONDITIONS = ["good", "fair", "poor"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const CONDITION_LABELS: Record<Condition, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
};

export const PREP_LEVELS = ["light", "standard", "heavy"] as const;
export type PrepLevel = (typeof PREP_LEVELS)[number];
export const PREP_LEVEL_LABELS: Record<PrepLevel, string> = {
  light: "Light",
  standard: "Standard",
  heavy: "Heavy",
};

export const PRIMERS = ["none", "spot", "full"] as const;
export type Primer = (typeof PRIMERS)[number];
export const PRIMER_LABELS: Record<Primer, string> = {
  none: "No primer",
  spot: "Spot prime",
  full: "Full prime",
};

export const COLOR_CHANGES = ["same", "light_to_dark", "dark_to_light"] as const;
export type ColorChange = (typeof COLOR_CHANGES)[number];
export const COLOR_CHANGE_LABELS: Record<ColorChange, string> = {
  same: "Same color",
  light_to_dark: "Light → dark",
  dark_to_light: "Dark → light",
};

/** What a color change adds (Estimate Setup decides per direction). */
export const COLOR_CHANGE_ACTIONS = ["none", "extra_coat", "primer"] as const;
export type ColorChangeAction = (typeof COLOR_CHANGE_ACTIONS)[number];
export const COLOR_CHANGE_ACTION_LABELS: Record<ColorChangeAction, string> = {
  none: "Nothing extra",
  extra_coat: "One extra finish coat",
  primer: "A full primer coat",
};

export const METHODS = ["brush_roll", "spray", "mixed"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABELS: Record<Method, string> = {
  brush_roll: "Brush & roll",
  spray: "Spray",
  mixed: "Mixed",
};

export const ACCESS_TYPES = ["ladder", "tall_ladder", "staging", "lift"] as const;
export type Access = (typeof ACCESS_TYPES)[number];
export const ACCESS_LABELS: Record<Access, string> = {
  ladder: "Ladder",
  tall_ladder: "Tall ladder",
  staging: "Staging",
  lift: "Lift",
};

export const HEIGHTS = ["one_story", "two_story", "three_plus"] as const;
export type Height = (typeof HEIGHTS)[number];
export const HEIGHT_LABELS: Record<Height, string> = {
  one_story: "1-story",
  two_story: "2-story",
  three_plus: "3+ stories",
};

export const COATS = [1, 2, 3] as const;
export type Coats = (typeof COATS)[number];

export const SIDES = [1, 2] as const;
export type Sides = (typeof SIDES)[number];

export const UNITS = [
  "sqft",
  "lf",
  "each",
  "hour",
  "room",
  "door",
  "drawer",
  "gallon",
  "lump",
  "pair",
  "step",
] as const;
export type Unit = (typeof UNITS)[number];
export const UNIT_LABELS: Record<Unit, string> = {
  sqft: "sq ft",
  lf: "lin ft",
  each: "each",
  hour: "hour",
  room: "room",
  door: "door",
  drawer: "drawer",
  gallon: "gallon",
  lump: "lump sum",
  pair: "pair",
  step: "step",
};

export const CATALOG_ITEM_TYPES = [
  "labor",
  "material",
  "add_on",
  "package",
  "fee",
  "discount",
] as const;
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number];
export const CATALOG_ITEM_TYPE_LABELS: Record<CatalogItemType, string> = {
  labor: "Labor",
  material: "Material",
  add_on: "Add-on",
  package: "Package",
  fee: "Fee",
  discount: "Discount",
};

/** Price book families (SPEC §8.12). */
export const CATALOG_FAMILIES = [
  "interior_labor",
  "exterior_labor",
  "cabinets",
  "deck_fence",
  "add_ons",
  "materials",
  "fees",
  "packages",
] as const;
export type CatalogFamily = (typeof CATALOG_FAMILIES)[number];
export const CATALOG_FAMILY_LABELS: Record<CatalogFamily, string> = {
  interior_labor: "Interior Labor",
  exterior_labor: "Exterior Labor",
  cabinets: "Cabinets",
  deck_fence: "Deck & Fence",
  add_ons: "Add-ons",
  materials: "Materials",
  fees: "Fees",
  packages: "Packages",
};

/** How a catalog item is priced. */
export const PRICING_METHODS = ["production_rate", "flat"] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];
export const PRICING_METHOD_LABELS: Record<PricingMethod, string> = {
  production_rate: "Production rate (labor + paint, margin pricing)",
  flat: "Flat price per unit",
};

/** Work-order phases (SPEC §5.4). */
export const WORK_ORDER_PHASES = [
  "prep",
  "repair",
  "paint",
  "cabinet_shop",
  "stain",
  "touch_up",
  "warranty",
] as const;
export type WorkOrderPhase = (typeof WORK_ORDER_PHASES)[number];
export const WORK_ORDER_PHASE_LABELS: Record<WorkOrderPhase, string> = {
  prep: "Prep",
  repair: "Repair",
  paint: "Paint",
  cabinet_shop: "Cabinet shop",
  stain: "Stain",
  touch_up: "Touch-up",
  warranty: "Warranty",
};

/** Paint containers a product is sold in. */
export const CONTAINERS = ["quart", "gallon", "five_gallon"] as const;
export type Container = (typeof CONTAINERS)[number];
export const CONTAINER_GALLONS: Record<Container, number> = {
  quart: 0.25,
  gallon: 1,
  five_gallon: 5,
};
export const CONTAINER_LABELS: Record<Container, string> = {
  quart: "Quart",
  gallon: "Gallon",
  five_gallon: "5-gallon",
};

export const PRODUCT_USES = ["interior", "exterior", "both"] as const;
export type ProductUse = (typeof PRODUCT_USES)[number];
export const PRODUCT_USE_LABELS: Record<ProductUse, string> = {
  interior: "Interior",
  exterior: "Exterior",
  both: "Interior & exterior",
};

export const DISCOUNT_TYPES = ["amount", "percent"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** Estimate version lifecycle. */
export const VERSION_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export const VERSION_STATUS_LABELS: Record<VersionStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  superseded: "Replaced by a newer version",
};

export const ESTIMATE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

export const CHANGE_ORDER_STATUSES = ["draft", "sent", "signed", "declined"] as const;
export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];
export const CHANGE_ORDER_STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  declined: "Declined",
};

export const AGREEMENT_DOC_TYPES = [
  "proposal",
  "contract",
  "change_order",
  "lead_safe_ack",
  "warranty",
  "invoice",
  "receipt",
] as const;
export type AgreementDocType = (typeof AGREEMENT_DOC_TYPES)[number];
export const AGREEMENT_DOC_TYPE_LABELS: Record<AgreementDocType, string> = {
  proposal: "Proposal",
  contract: "Contract",
  change_order: "Change Order",
  lead_safe_ack: "Lead-Safe Acknowledgment",
  warranty: "Warranty",
  invoice: "Invoice",
  receipt: "Receipt",
};

/** Work types that have a "What's included" text (SPEC §7.6). */
export const INCLUSION_WORK_TYPES = ["interior", "exterior", "cabinets", "deck_fence"] as const;
export type InclusionWorkType = (typeof INCLUSION_WORK_TYPES)[number];

/** Badge text for seeded numbers nobody has calibrated yet (SPEC §7.4). */
export const SAMPLE_BADGE = "Sample – Erik to calibrate";
/** Badge text for seeded wording nobody has approved yet (SPEC §7.6, §13.4). */
export const DRAFT_BADGE = "Draft – owner to approve";
export const LEGAL_DRAFT_BADGE = "Draft – owner/attorney to approve";

/** Sheen picked for a new line when its default product offers several. */
export const LINE_SHEEN_PREFERENCE: readonly string[] = [
  "eggshell",
  "satin",
  "semi_gloss",
  "flat",
  "matte",
  "gloss",
];
/** Work on painted surfaces that gets lead-safe prep in pre-1978 homes (SPEC §7.3). */
export const LEAD_SAFE_WORK_TYPES: ReadonlySet<string> = new Set([
  "interior",
  "exterior",
  "cabinets",
]);
