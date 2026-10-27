/**
 * The small Markdown subset Help Center articles use: "## " and "### "
 * headings, paragraphs, "- " lists, "1. " lists, **bold**, `code` and
 * [links](/path or https://…). Parsed to plain data and rendered as React
 * elements, never as HTML, so an article can't inject markup or scripts.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "heading"; level: 2 | 3; text: string; id: string }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] };

const SAFE_HREF = /^(\/[^\s]*|https:\/\/[^\s]+|mailto:[^\s]+)$/;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Inline formatting inside one line. Unsafe links become plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "code", text: m[2] });
    else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(
        SAFE_HREF.test(m[4])
          ? { type: "link", text: m[3], href: m[4] }
          : { type: "text", text: m[3] },
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", inline: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    const ul = /^\s*[-*]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const text = h[2]!.trim();
      blocks.push({ type: "heading", level: h[1]!.length === 2 ? 2 : 3, text, id: slugify(text) });
    } else if (ul || ol) {
      flushPara();
      const type = ul ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(parseInline((ul ?? ol)![1]!));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of an article (search snippets, previews). */
export function plainText(src: string): string {
  return src
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*([-*]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
