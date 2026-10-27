import { lookup, type MergeContext, type MergeValue } from "@/lib/domain/templates/merge";
import type { Condition } from "./types";

/** Evaluate workflow conditions against a run's facts (pure). */

function scalar(v: MergeValue): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return null;
}

function isEmpty(v: MergeValue): boolean {
  return (
    v === undefined ||
    v === null ||
    v === false ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0)
  );
}

function compare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export function evaluateCondition(c: Condition, facts: MergeContext): boolean {
  const v = lookup(facts, c.field);
  const s = scalar(v);
  const list = Array.isArray(c.value) ? (c.value as readonly (string | number)[]) : null;
  switch (c.op) {
    case "eq":
      return s === (c.value ?? null);
    case "neq":
      return s !== (c.value ?? null);
    case "in":
      return s !== null && !!list && list.some((x) => x === s);
    case "not_in":
      return !(s !== null && !!list && list.some((x) => x === s));
    case "exists":
      return !(v === undefined || v === null || (typeof v === "string" && v.trim() === ""));
    case "missing":
      return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    case "truthy":
      return !isEmpty(v);
    case "falsy":
      return isEmpty(v);
    case "includes":
      return (
        Array.isArray(v) &&
        (list
          ? list.some((x) => v.includes(x))
          : v.includes(scalar(c.value as MergeValue) as string))
      );
    case "excludes":
      return !(
        Array.isArray(v) &&
        (list
          ? list.some((x) => v.includes(x))
          : v.includes(scalar(c.value as MergeValue) as string))
      );
    case "gte":
      return s !== null &&
        typeof s !== "boolean" &&
        c.value !== undefined &&
        c.value !== null &&
        !Array.isArray(c.value)
        ? compare(s, c.value as string | number) >= 0
        : false;
    case "lte":
      return s !== null &&
        typeof s !== "boolean" &&
        c.value !== undefined &&
        c.value !== null &&
        !Array.isArray(c.value)
        ? compare(s, c.value as string | number) <= 0
        : false;
  }
}

export function allHold(
  conditions: readonly Condition[] | undefined,
  facts: MergeContext,
): boolean {
  return (conditions ?? []).every((c) => evaluateCondition(c, facts));
}

export function anyHolds(
  conditions: readonly Condition[] | undefined,
  facts: MergeContext,
): boolean {
  return (conditions ?? []).some((c) => evaluateCondition(c, facts));
}

/** The first condition that fails, for "skipped because …" lines. */
export function firstFailing(
  conditions: readonly Condition[] | undefined,
  facts: MergeContext,
): Condition | null {
  return (conditions ?? []).find((c) => !evaluateCondition(c, facts)) ?? null;
}

const OP_WORDS: Record<Condition["op"], string> = {
  eq: "is",
  neq: "isn't",
  in: "is one of",
  not_in: "isn't one of",
  exists: "is set",
  missing: "is empty",
  truthy: "is yes",
  falsy: "is no",
  includes: "includes",
  excludes: "doesn't include",
  gte: "is at least",
  lte: "is at most",
};

export function describeCondition(c: Condition): string {
  if (c.label) return c.label;
  const v = Array.isArray(c.value)
    ? (c.value as readonly (string | number)[]).join(", ")
    : c.value === undefined
      ? ""
      : String(c.value);
  return `${c.field} ${OP_WORDS[c.op]}${v ? ` ${v}` : ""}`;
}
