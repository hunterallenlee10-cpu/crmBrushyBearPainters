import {
  exteriorWallSqft,
  fenceSqft,
  roomBaseboardLf,
  roomCeilingSqft,
  roomWallSqft,
} from "@/lib/estimating/engine";

/**
 * Turns a measurement-helper entry into a line quantity (SPEC §7.3). Pure.
 * Door/window deductions and the default gable factor come from Estimate Setup.
 */

export type Measurement = {
  kind?: "room_walls" | "room_ceiling" | "room_baseboard" | "exterior_wall" | "fence";
  lengthFt?: number;
  widthFt?: number;
  heightFt?: number;
  doors?: number;
  windows?: number;
  gableFactor?: number;
  sides?: 1 | 2;
};

export const MEASUREMENT_LABELS: Record<NonNullable<Measurement["kind"]>, string> = {
  room_walls: "Room walls (L × W × H, minus doors and windows)",
  room_ceiling: "Room ceiling (L × W)",
  room_baseboard: "Room baseboard (perimeter minus doors)",
  exterior_wall: "Exterior wall (width × height × gable factor)",
  fence: "Fence (length × height × sides)",
};

export function quantityFromMeasurement(
  m: Measurement,
  settings: { doorDeductionSqft: number; windowDeductionSqft: number; gableFactor: number },
): number | null {
  const l = m.lengthFt ?? 0;
  const w = m.widthFt ?? 0;
  const h = m.heightFt ?? 0;
  switch (m.kind) {
    case "room_walls":
      return roomWallSqft(
        { lengthFt: l, widthFt: w, heightFt: h, doors: m.doors ?? 0, windows: m.windows ?? 0 },
        settings,
      );
    case "room_ceiling":
      return roomCeilingSqft({ lengthFt: l, widthFt: w });
    case "room_baseboard":
      return roomBaseboardLf({ lengthFt: l, widthFt: w, doors: m.doors ?? 0 });
    case "exterior_wall":
      return exteriorWallSqft({
        widthFt: w || l,
        heightFt: h,
        gableFactor: m.gableFactor ?? settings.gableFactor,
      });
    case "fence":
      return fenceSqft({ lengthFt: l, heightFt: h, sides: m.sides ?? 1 });
    default:
      return null;
  }
}

/** Which helper fits a surface (by unit and code). */
export function defaultMeasurementKind(input: {
  unit: string;
  surface: string | null;
}): Measurement["kind"] | null {
  const s = input.surface ?? "";
  if (s === "fence") return "fence";
  if (s.startsWith("ext_siding") || s === "ext_foundation") return "exterior_wall";
  if (s === "int_ceilings") return "room_ceiling";
  if (s === "int_baseboard") return "room_baseboard";
  if (s === "int_walls" || s === "int_accent_wall") return "room_walls";
  return input.unit === "sqft" ? "room_walls" : null;
}
