import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import type { ProposalOption, QuoteTotals, TemplateBlock } from "@/lib/estimating/engine";
import type { ProposalView } from "@/lib/estimating/proposal-view";
import { formatDate, formatDateTime } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";
import { styles } from "./theme";

/**
 * Proposal PDF and the signed proposal + contract (SPEC §7.5 #1–2). The same
 * view model feeds the /p/[token] page, so the PDF says exactly what the
 * customer saw and signed.
 */

export function CompanyHeaderBlock({ view, title }: { view: ProposalView; title: string }) {
  const c = view.company;
  return (
    <View style={styles.header} fixed>
      <Text style={styles.company}>{c.name}</Text>
      {c.tagline ? <Text style={styles.tagline}>{c.tagline}</Text> : null}
      <Text style={styles.headerMeta}>
        {[c.phone, c.email, c.hours].join("  ·  ")}
        {"\n"}WA L&amp;I contractor reg. {c.lniNumber} · UBI {c.ubiNumber}
        {c.website ? `  ·  ${c.website}` : ""}
      </Text>
      <Text style={[styles.headerMeta, { fontFamily: "Helvetica-Bold" }]}>{title}</Text>
    </View>
  );
}

export function Footer({ view }: { view: ProposalView }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        {view.company.name} · {view.document.number}
        {view.document.version ? ` v${view.document.version}` : ""}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function Blocks({ blocks }: { blocks: TemplateBlock[] }) {
  return (
    <View>
      {blocks.map((b, i) =>
        b.kind === "heading" ? (
          <Text key={i} style={b.level === 1 ? styles.title : styles.h2}>
            {b.text}
          </Text>
        ) : b.kind === "placeholder" ? (
          <Text key={i} style={styles.placeholder}>
            {b.text}
          </Text>
        ) : (
          <Text key={i} style={{ marginBottom: 4 }}>
            {b.text}
          </Text>
        ),
      )}
    </View>
  );
}

function Totals({ totals, depositLabel }: { totals: QuoteTotals; depositLabel?: boolean }) {
  const row = (label: string, cents: number) => (
    <View style={styles.totalRow}>
      <Text>{label}</Text>
      <Text>{formatCents(cents)}</Text>
    </View>
  );
  return (
    <View style={{ marginTop: 6, marginLeft: "45%" }}>
      {row("Scope", totals.linesCents)}
      {totals.addOnsCents ? row("Add-ons", totals.addOnsCents) : null}
      {totals.rrpCents ? row("Lead-safe (RRP) supplies", totals.rrpCents) : null}
      {totals.minimumAdjustmentCents
        ? row("Minimum job charge", totals.minimumAdjustmentCents)
        : null}
      {totals.discountCents ? row("Discount", -totals.discountCents) : null}
      {totals.taxCents ? row("Tax", totals.taxCents) : null}
      <View style={styles.grandTotal}>
        <Text>Total</Text>
        <Text>{formatCents(totals.totalCents)}</Text>
      </View>
      {depositLabel !== false && totals.depositCents ? (
        <View style={styles.totalRow}>
          <Text style={styles.muted}>Deposit to book</Text>
          <Text style={styles.muted}>{formatCents(totals.depositCents)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function OptionBlock({ option, view }: { option: ProposalOption; view: ProposalView }) {
  const totals =
    view.selection && view.selection.optionId === option.id ? view.selection.totals : option.totals;
  return (
    <View style={styles.box} wrap>
      <Text style={styles.h3}>
        {option.name}
        {option.isRecommended && !view.selection ? "  (recommended)" : ""}
      </Text>
      {option.description ? <Text style={styles.muted}>{option.description}</Text> : null}
      {option.areas.map((a, i) => (
        <View key={i} style={{ marginTop: 4 }}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>{a.name}</Text>
          {a.lines.map((l) => (
            <View key={l.id} style={styles.bullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{l.description}</Text>
            </View>
          ))}
        </View>
      ))}
      <Totals totals={totals} />
    </View>
  );
}

export function ProposalBody({ view }: { view: ProposalView }) {
  const signed = view.signature !== null;
  return (
    <View>
      <Text style={styles.title}>
        {signed ? "Signed proposal" : "Proposal"} {view.document.number}
      </Text>
      <Text style={styles.muted}>
        Prepared for {view.customer.name}
        {view.customer.address ? ` · ${view.customer.address}` : ""}
        {"\n"}
        Job {view.job.number}
        {view.sentAt ? ` · Sent ${formatDate(view.sentAt)}` : ""}
        {view.expiresAt && !signed ? ` · Good until ${formatDate(view.expiresAt)}` : ""}
        {view.pointOfContact ? ` · Your point of contact: ${view.pointOfContact}` : ""}
      </Text>
      {view.customerNotes ? <Text style={{ marginTop: 6 }}>{view.customerNotes}</Text> : null}

      <Text style={styles.h2}>{view.snapshot.options.length > 1 ? "Options" : "Scope"}</Text>
      {view.snapshot.options.map((o) => (
        <OptionBlock key={o.id} option={o} view={view} />
      ))}

      {view.snapshot.addOns.length ? (
        <View>
          <Text style={styles.h2}>{signed ? "Add-ons you chose" : "Optional add-ons"}</Text>
          {view.snapshot.addOns.map((a) => (
            <View key={a.id} style={styles.tableRow}>
              <Text style={{ flex: 1 }}>{a.description}</Text>
              <Text>{formatCents(a.priceCents)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {view.inclusions.map((inc) => (
        <View key={inc.workType} wrap={false}>
          <Text style={styles.h2}>What&apos;s included · {inc.label}</Text>
          {inc.draft ? <Text style={styles.draft}>Draft – owner to approve</Text> : null}
          {inc.items.map((item, i) => (
            <View key={i} style={styles.bullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      ))}

      {view.guarantees.length ? (
        <View wrap={false}>
          <Text style={styles.h2}>Our promises</Text>
          {view.guarantees.map((g) => (
            <View key={g.key} style={styles.bullet}>
              <Text style={styles.bulletDot}>✓</Text>
              <Text style={styles.bulletText}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>{g.title}. </Text>
                {g.body}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {view.leadSafe ? (
        <View wrap={false}>
          <Text style={styles.h2}>Lead-safe work</Text>
          <Text>{view.leadSafe}</Text>
        </View>
      ) : null}

      {view.terms ? (
        <View>
          <Text style={styles.h2}>Terms</Text>
          {view.terms.draft ? (
            <Text style={styles.draft}>Draft – owner/attorney to approve</Text>
          ) : null}
          <Blocks
            blocks={view.terms.blocks.filter((b) => !(b.kind === "heading" && b.level === 1))}
          />
        </View>
      ) : null}
    </View>
  );
}

export function SignatureBlock({ view }: { view: ProposalView }) {
  const s = view.signature;
  if (!s) return null;
  return (
    <View style={[styles.box, { marginTop: 14 }]} wrap={false}>
      <Text style={styles.h3}>Accepted and signed</Text>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt text */}
      <Image src={s.png} style={styles.signatureImage} />
      <Text>
        {s.name} · {formatDateTime(s.signedAt)} (Pacific)
      </Text>
      <Text style={[styles.muted, styles.small]}>
        Signed electronically from IP {s.ip ?? "unknown"} · {s.userAgent ?? "unknown device"}
      </Text>
    </View>
  );
}

/** Proposal (unsigned) or signed proposal + contract. */
export function ProposalDocument({ view }: { view: ProposalView }) {
  const signed = view.signature !== null;
  return (
    <Document
      title={`${signed ? "Signed proposal" : "Proposal"} ${view.document.number}`}
      author={view.company.name}
      creator="Brushy Bear CRM"
    >
      <Page size="LETTER" style={styles.page}>
        <CompanyHeaderBlock
          view={view}
          title={signed ? "Signed proposal & contract" : "Proposal"}
        />
        <ProposalBody view={view} />
        <SignatureBlock view={view} />
        <Footer view={view} />
      </Page>
      {signed && view.contract ? (
        <Page size="LETTER" style={styles.page}>
          <CompanyHeaderBlock view={view} title="Contract" />
          {view.contract.draft ? (
            <Text style={styles.draft}>Draft – owner/attorney to approve</Text>
          ) : null}
          <Blocks blocks={view.contract.blocks} />
          <SignatureBlock view={view} />
          <Footer view={view} />
        </Page>
      ) : null}
    </Document>
  );
}
