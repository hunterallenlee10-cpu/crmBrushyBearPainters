import "server-only";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

/**
 * Renders a component whose root is a react-pdf <Document> to PDF bytes on the
 * server. (react-pdf types the argument as a <Document> element; our document
 * components render one.)
 */
export async function renderPdf(doc: ReactElement): Promise<Buffer> {
  return renderToBuffer(doc as ReactElement<DocumentProps>);
}

/** Response headers for a PDF download (never cached: it may be a signed document). */
export function pdfHeaders(fileName: string, disposition: "inline" | "attachment" = "inline") {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, "-");
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${disposition}; filename="${safe}"`,
    "Cache-Control": "private, no-store",
  };
}
