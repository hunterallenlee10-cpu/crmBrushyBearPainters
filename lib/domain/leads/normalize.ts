import { normalizeZip } from "@/lib/domain/territory";

/**
 * Input cleanup shared by the website intake, the New Lead wizard and imports
 * (SPEC §14: split name, E.164 phone, lowercase email, address/ZIP parsing).
 * Pure functions; no I/O.
 */

/** US/Canada numbers to E.164 (+1XXXXXXXXXX). Other countries need a leading "+". */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // Drop extensions like "x123" or "ext. 4".
  const main = trimmed.split(/\s*(?:x|ext\.?|extension)\s*\d+$/i)[0] ?? trimmed;
  const digits = main.replace(/\D/g, "");
  if (main.startsWith("+")) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && /^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
    return `+${digits}`;
  }
  return null;
}

/** "(425) 555-0100" style for display. Falls back to the stored value. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const email = input.trim().toLowerCase();
  if (email === "" || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Splits a full name into first and last ("Mary Ann Smith" → "Mary Ann" / "Smith"). */
export function splitName(full: string | null | undefined): { first: string; last: string | null } {
  const clean = (full ?? "").replace(/\s+/g, " ").trim();
  if (clean === "") return { first: "", last: null };
  // "Smith, Jane" → Jane Smith
  const comma = /^([^,]+),\s*(.+)$/.exec(clean);
  if (comma) return { first: comma[2]!.trim(), last: comma[1]!.trim() };
  const parts = clean.split(" ");
  if (parts.length === 1) return { first: parts[0]!, last: null };
  const last = parts.pop()!;
  return { first: parts.join(" "), last };
}

export type ParsedLocation = {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

/**
 * Parses the website's "Home address or ZIP code" box.
 *   "98033"                               → zip only
 *   "123 Main St, Kirkland, WA 98033"     → street, city, state, zip
 *   "123 Main St Kirkland 98033"          → street (rest), zip
 *   "Kirkland"                            → city only
 */
export function parseLocation(input: string | null | undefined): ParsedLocation {
  const empty: ParsedLocation = { street: null, city: null, state: null, zip: null };
  const raw = (input ?? "").replace(/\s+/g, " ").trim();
  if (raw === "") return empty;

  const zipMatch = /\b(\d{5})(?:-\d{4})?\s*$/.exec(raw);
  const zip = zipMatch ? normalizeZip(zipMatch[1]) : null;
  let rest = zipMatch ? raw.slice(0, zipMatch.index).trim() : raw;
  rest = rest.replace(/,\s*$/, "").trim();

  let state: string | null = null;
  const stateMatch = /(?:,\s*|\s)(WA|Washington|OR|Oregon|ID|Idaho)$/i.exec(rest);
  if (stateMatch) {
    const s = stateMatch[1]!.toUpperCase();
    state = s.startsWith("WASH")
      ? "WA"
      : s.startsWith("ORE")
        ? "OR"
        : s.startsWith("IDA")
          ? "ID"
          : s;
    rest = rest.slice(0, stateMatch.index).replace(/,\s*$/, "").trim();
  }

  if (rest === "") return { ...empty, zip, state };

  const parts = rest
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { street: parts.slice(0, -1).join(", "), city: titleCase(parts.at(-1)!), state, zip };
  }
  // One chunk: a street if it starts with a house number, otherwise a city.
  if (/^\d+\s+\S/.test(rest)) return { street: rest, city: null, state, zip };
  return { street: null, city: titleCase(rest), state, zip };
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** Digits only, for matching and search ("(425) 555-0100" → "4255550100"). */
export function phoneDigits(input: string | null | undefined): string {
  return (input ?? "").replace(/\D/g, "");
}
