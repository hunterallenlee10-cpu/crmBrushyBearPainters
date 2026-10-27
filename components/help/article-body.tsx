import Link from "next/link";
import { parseMarkdown, type Inline } from "@/lib/domain/help/markdown";

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.type === "bold" ? (
          <strong key={i}>{p.text}</strong>
        ) : p.type === "code" ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
            {p.text}
          </code>
        ) : p.type === "link" ? (
          p.href.startsWith("/") ? (
            <Link key={i} href={p.href} className="text-bb-forest underline">
              {p.text}
            </Link>
          ) : (
            <a
              key={i}
              href={p.href}
              className="text-bb-forest underline"
              rel="noreferrer noopener"
              target="_blank"
            >
              {p.text}
            </a>
          )
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** Renders a Help Center article (safe Markdown subset; no HTML). */
export function ArticleBody({ body }: { body: string }) {
  const blocks = parseMarkdown(body);
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === "heading")
          return b.level === 2 ? (
            <h2 key={i} id={b.id} className="mt-3 text-lg font-semibold text-bb-ink">
              {b.text}
            </h2>
          ) : (
            <h3 key={i} id={b.id} className="mt-2 text-base font-semibold text-bb-ink">
              {b.text}
            </h3>
          );
        if (b.type === "paragraph")
          return (
            <p key={i}>
              <InlineText parts={b.inline} />
            </p>
          );
        const Tag = b.type === "ol" ? "ol" : "ul";
        return (
          <Tag
            key={i}
            className={b.type === "ol" ? "list-decimal space-y-1 pl-6" : "list-disc space-y-1 pl-6"}
          >
            {b.items.map((item, j) => (
              <li key={j}>
                <InlineText parts={item} />
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
