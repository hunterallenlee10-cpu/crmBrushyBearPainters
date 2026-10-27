/**
 * Release Notes (Help → Release Notes) from CHANGELOG.md: one entry per build
 * phase ("## Phase N — Title") with its "Added" and "Changed" bullets. Test
 * counts and other developer sections are left out. Pure.
 */

export type ReleaseNote = {
  phase: number | null;
  title: string;
  added: string[];
  changed: string[];
};

/** Removes Markdown emphasis/code/link syntax and file paths in backticks stay as text. */
function clean(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export function parseReleaseNotes(changelog: string): ReleaseNote[] {
  const notes: ReleaseNote[] = [];
  let current: ReleaseNote | null = null;
  let section: "added" | "changed" | null = null;
  for (const raw of changelog.replace(/\r\n?/g, "\n").split("\n")) {
    const h2 = /^##\s+(.+)$/.exec(raw);
    if (h2) {
      const title = clean(h2[1]!);
      const phase = /^Phase\s+(\d+)/i.exec(title);
      current = { phase: phase ? Number(phase[1]) : null, title, added: [], changed: [] };
      notes.push(current);
      section = null;
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(raw);
    if (h3) {
      const name = h3[1]!.trim().toLowerCase();
      section = name.startsWith("added")
        ? "added"
        : name.startsWith("changed") || name.startsWith("fixed")
          ? "changed"
          : null;
      continue;
    }
    const bullet = /^- (.+)$/.exec(raw);
    if (bullet && current && section) {
      current[section].push(clean(bullet[1]!));
    } else if (raw.startsWith("  ") && current && section && current[section].length) {
      const list = current[section];
      list[list.length - 1] = `${list[list.length - 1]} ${clean(raw)}`;
    }
  }
  return notes.filter((n) => n.added.length + n.changed.length > 0);
}
