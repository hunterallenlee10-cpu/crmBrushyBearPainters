/**
 * Measurement helpers for the builder (SPEC §7.3): turn tape-measure numbers
 * into quantities. Pure; results are rounded to 2 decimals (numeric(12,2)).
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function nonNegative(n: number, label: string): number {
  if (!Number.isFinite(n) || n < 0) throw new RangeError(`${label} must be zero or more.`);
  return n;
}

export type RoomInput = {
  lengthFt: number;
  widthFt: number;
  heightFt: number;
  doors?: number;
  windows?: number;
};

/** Wall area of a room: perimeter × height, minus the standard door and window deductions. */
export function roomWallSqft(
  room: RoomInput,
  deductions: { doorDeductionSqft: number; windowDeductionSqft: number },
): number {
  const l = nonNegative(room.lengthFt, "Length");
  const w = nonNegative(room.widthFt, "Width");
  const h = nonNegative(room.heightFt, "Height");
  const doors = nonNegative(room.doors ?? 0, "Doors");
  const windows = nonNegative(room.windows ?? 0, "Windows");
  const gross = 2 * (l + w) * h;
  const net =
    gross - doors * deductions.doorDeductionSqft - windows * deductions.windowDeductionSqft;
  return round2(Math.max(0, net));
}

/** Ceiling area of a rectangular room. */
export function roomCeilingSqft(room: Pick<RoomInput, "lengthFt" | "widthFt">): number {
  return round2(nonNegative(room.lengthFt, "Length") * nonNegative(room.widthFt, "Width"));
}

/** Baseboard length: the room's perimeter minus door openings. */
export function roomBaseboardLf(
  room: Pick<RoomInput, "lengthFt" | "widthFt" | "doors">,
  doorWidthFt = 3,
): number {
  const perimeter = 2 * (nonNegative(room.lengthFt, "Length") + nonNegative(room.widthFt, "Width"));
  const openings = nonNegative(room.doors ?? 0, "Doors") * nonNegative(doorWidthFt, "Door width");
  return round2(Math.max(0, perimeter - openings));
}

/** Exterior wall: width × height × gable factor (1 = flat wall, more for a gable end). */
export function exteriorWallSqft(input: {
  widthFt: number;
  heightFt: number;
  gableFactor: number;
}): number {
  const factor = nonNegative(input.gableFactor, "Gable factor");
  if (factor < 1) throw new RangeError("Gable factor must be 1 or more.");
  return round2(
    nonNegative(input.widthFt, "Width") * nonNegative(input.heightFt, "Height") * factor,
  );
}

/** Fence face area: length × height × sides stained. */
export function fenceSqft(input: { lengthFt: number; heightFt: number; sides: 1 | 2 }): number {
  return round2(
    nonNegative(input.lengthFt, "Length") * nonNegative(input.heightFt, "Height") * input.sides,
  );
}

/** Sum of several measured walls (e.g. every elevation of a house). */
export function sumSqft(values: readonly number[]): number {
  return round2(values.reduce((s, v) => s + nonNegative(v, "Area"), 0));
}
