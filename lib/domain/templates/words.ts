/** Plain words for merge fields (pure). */

const SERVICE_WORDS: Record<string, string> = {
  interior: "interior painting",
  exterior: "exterior painting",
  cabinets: "cabinet painting",
  deck_fence: "deck and fence staining",
  add_on_only: "repair work",
  other: "painting",
};

/** ["exterior", "cabinets"] → "exterior painting and cabinet painting". */
export function serviceWords(keys: readonly string[] | null | undefined): string {
  const words = [...new Set((keys ?? []).map((k) => SERVICE_WORDS[k] ?? k.replace(/_/g, " ")))];
  if (!words.length) return "painting";
  if (words.length === 1) return words[0] as string;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** "Hunter Lee" → "Hunter". */
export function firstWord(name: string | null | undefined): string | null {
  const w = name?.trim().split(/\s+/)[0];
  return w ? w : null;
}

/** Texts stay in the plain GSM alphabet: dashes and curly quotes become ASCII. */
export function asciiPunctuation(text: string): string {
  return text
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...");
}
