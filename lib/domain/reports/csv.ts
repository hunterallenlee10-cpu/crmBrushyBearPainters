/**
 * CSV for "Download CSV" (SPEC §8). RFC 4180 quoting, CRLF line ends, a UTF-8
 * BOM so Excel reads accents, and a guard against spreadsheet formula
 * injection: a cell starting with = + - @ (or tab / carriage return) is
 * prefixed with an apostrophe unless it is a plain number. Pure.
 */

export type CsvCell = string | number | boolean | null | undefined;

const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** A safe file name: "Lead Funnel – This Month" → "lead-funnel-this-month-2026-10-27.csv". */
export function csvFileName(title: string, day: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "export"}-${day}.csv`;
}
