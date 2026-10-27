import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { CompanyHeader } from "@/lib/estimating/proposal-view";
import { formatDate } from "@/lib/format/dates";
import { formatCents } from "@/lib/format/money";
import { styles } from "./theme";

/** Color sheet (SPEC §7.5 #4) and the deposit invoice PDF. */

function Header({ company, title }: { company: CompanyHeader; title: string }) {
  return (
    <View style={styles.header} fixed>
      <Text style={styles.company}>{company.name}</Text>
      <Text style={styles.headerMeta}>
        {[company.phone, company.email].join("  ·  ")}
        {"\n"}WA L&amp;I contractor reg. {company.lniNumber} · UBI {company.ubiNumber}
      </Text>
      <Text style={[styles.headerMeta, { fontFamily: "Helvetica-Bold" }]}>{title}</Text>
    </View>
  );
}

function Footer({ left }: { left: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>{left}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export type ColorSheetRow = {
  area: string;
  surface: string;
  brand: string | null;
  colorName: string | null;
  colorCode: string | null;
  sheen: string | null;
  product: string | null;
  notes: string | null;
  confirmed: boolean;
};

export function ColorSheetDocument(props: {
  company: CompanyHeader;
  customerName: string;
  address: string | null;
  jobNumber: string;
  rows: ColorSheetRow[];
  generatedAt: string;
}) {
  const cols = [
    { key: "area", label: "Area", flex: 1.2 },
    { key: "surface", label: "Surface", flex: 1.4 },
    { key: "color", label: "Color", flex: 1.6 },
    { key: "sheen", label: "Sheen", flex: 0.8 },
    { key: "product", label: "Product", flex: 1.6 },
  ] as const;
  return (
    <Document title={`Color sheet ${props.jobNumber}`} author={props.company.name}>
      <Page size="LETTER" style={styles.page}>
        <Header company={props.company} title="Color sheet" />
        <Text style={styles.title}>Color sheet · {props.jobNumber}</Text>
        <Text style={styles.muted}>
          {props.customerName}
          {props.address ? ` · ${props.address}` : ""} · Printed {formatDate(props.generatedAt)}
        </Text>
        <View style={{ marginTop: 12 }}>
          <View style={styles.tableHead}>
            {cols.map((c) => (
              <Text key={c.key} style={{ flex: c.flex }}>
                {c.label}
              </Text>
            ))}
          </View>
          {props.rows.length === 0 ? (
            <Text style={styles.muted}>No colors picked yet.</Text>
          ) : (
            props.rows.map((r, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={{ flex: 1.2 }}>{r.area}</Text>
                <Text style={{ flex: 1.4 }}>{r.surface}</Text>
                <Text style={{ flex: 1.6 }}>
                  {r.colorName
                    ? `${r.colorName}${r.colorCode ? ` (${r.colorCode})` : ""}`
                    : "To be picked"}
                  {r.brand ? `\n${r.brand}` : ""}
                  {r.confirmed ? "\nConfirmed by the customer" : ""}
                </Text>
                <Text style={{ flex: 0.8 }}>{r.sheen ?? "—"}</Text>
                <Text style={{ flex: 1.6 }}>
                  {r.product ?? "—"}
                  {r.notes ? `\n${r.notes}` : ""}
                </Text>
              </View>
            ))
          )}
        </View>
        <Text style={[styles.muted, styles.small, { marginTop: 12 }]}>
          Please check every color and sheen. Tell your point of contact about any change before the
          crew starts.
        </Text>
        <Footer left={`${props.company.name} · Color sheet ${props.jobNumber}`} />
      </Page>
    </Document>
  );
}

export type InvoicePdfLine = { description: string; quantity: number; amountCents: number };

export function InvoiceDocument(props: {
  company: CompanyHeader;
  customerName: string;
  address: string | null;
  invoiceNumber: string;
  invoiceType: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  terms: string | null;
  jobNumber: string;
  lines: InvoicePdfLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}) {
  const typeLabel =
    props.invoiceType === "deposit"
      ? "Deposit invoice"
      : props.invoiceType === "change_order"
        ? "Change order invoice"
        : props.invoiceType === "credit_memo"
          ? "Credit memo"
          : "Invoice";
  return (
    <Document title={`${typeLabel} ${props.invoiceNumber}`} author={props.company.name}>
      <Page size="LETTER" style={styles.page}>
        <Header company={props.company} title={typeLabel} />
        <View style={styles.row}>
          <View>
            <Text style={styles.title}>
              {typeLabel} {props.invoiceNumber}
            </Text>
            <Text>{props.customerName}</Text>
            {props.address ? <Text style={styles.muted}>{props.address}</Text> : null}
          </View>
          <View>
            <Text>Job {props.jobNumber}</Text>
            <Text>Issued {props.issueDate ? formatDate(`${props.issueDate}T12:00:00Z`) : "—"}</Text>
            <Text>
              Due {props.dueDate ? formatDate(`${props.dueDate}T12:00:00Z`) : "on receipt"}
            </Text>
            {props.status === "draft" ? (
              <Text style={styles.draft}>Draft – not sent yet</Text>
            ) : null}
          </View>
        </View>
        <View style={{ marginTop: 16 }}>
          <View style={styles.tableHead}>
            <Text style={{ flex: 4 }}>Description</Text>
            <Text style={{ flex: 1, textAlign: "right" }}>Amount</Text>
          </View>
          {props.lines.map((l, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={{ flex: 4 }}>{l.description}</Text>
              <Text style={{ flex: 1, textAlign: "right" }}>{formatCents(l.amountCents)}</Text>
            </View>
          ))}
        </View>
        <View style={{ marginTop: 8, marginLeft: "55%" }}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{formatCents(props.subtotalCents)}</Text>
          </View>
          {props.taxCents ? (
            <View style={styles.totalRow}>
              <Text>Tax</Text>
              <Text>{formatCents(props.taxCents)}</Text>
            </View>
          ) : null}
          <View style={styles.grandTotal}>
            <Text>Total</Text>
            <Text>{formatCents(props.totalCents)}</Text>
          </View>
        </View>
        <Text style={[styles.muted, { marginTop: 16 }]}>
          {props.terms ?? "[PAYMENT_TERMS — owner to provide how and when to pay]"}
        </Text>
        <Footer left={`${props.company.name} · ${props.invoiceNumber}`} />
      </Page>
    </Document>
  );
}
