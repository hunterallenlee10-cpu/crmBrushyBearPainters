/** Masks emails and phone numbers so logs stay PII-free (SPEC §13.1). */
export function maskPii(text: string): string {
  return text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/(?:\+?\d|\()[\d\s().-]{7,}\d/g, "[phone]");
}

/** Server-side error log with PII masked. */
export function logError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${scope}]`, maskPii(message));
}
