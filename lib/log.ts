/** Masks emails and phone numbers so logs stay PII-free (SPEC §13.1). */
export function maskPii(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/(?:\+?\d|\()[\d\s().-]{7,}\d/g, "[phone]");
}

/** Server-side error log with PII masked. */
export function logError(scope: string, error: unknown): void {
  const message = describeError(error);
  console.error(`[${scope}]`, maskPii(message));
}

/** Error, Supabase/PostgREST error object ({ message, code, details, hint }) or anything else. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const o = error as Record<string, unknown>;
    const parts = ["message", "code", "details", "hint"]
      .map((k) => (typeof o[k] === "string" && o[k] ? `${k}=${String(o[k])}` : null))
      .filter((p): p is string => p !== null);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(error);
    } catch {
      return "[unserializable error]";
    }
  }
  return String(error);
}
