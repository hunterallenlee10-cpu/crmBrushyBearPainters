import { StyleSheet } from "@react-pdf/renderer";

/**
 * Brand look for PDFs (SPEC §16: cream/forest on customer-facing documents).
 * Built-in Helvetica keeps rendering dependable on the server; the Lilita One
 * wordmark arrives with the real logo files (public/brand/).
 */

export const PDF_COLORS = {
  forest: "#1F4D3A",
  forestDark: "#163829",
  honey: "#E9A93B",
  cream: "#F4EDE1",
  creamLight: "#FAF6EF",
  ink: "#2B2B2B",
  border: "#E6DAC6",
  muted: "#5B5B5B",
  draft: "#9A3412",
} as const;

export const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 54,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.45,
    color: PDF_COLORS.ink,
  },
  header: {
    backgroundColor: PDF_COLORS.cream,
    borderBottomWidth: 2,
    borderBottomColor: PDF_COLORS.forest,
    marginHorizontal: -40,
    marginTop: -36,
    paddingHorizontal: 40,
    paddingVertical: 18,
    marginBottom: 18,
  },
  company: { fontFamily: "Helvetica-Bold", fontSize: 18, color: PDF_COLORS.forest },
  tagline: { fontSize: 9, color: PDF_COLORS.forestDark, marginTop: 2 },
  headerMeta: { fontSize: 8.5, color: PDF_COLORS.muted, marginTop: 6 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, color: PDF_COLORS.forest, marginBottom: 4 },
  h2: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    color: PDF_COLORS.forest,
    marginTop: 14,
    marginBottom: 6,
  },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 10.5, marginTop: 8, marginBottom: 3 },
  muted: { color: PDF_COLORS.muted },
  small: { fontSize: 8.5 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  box: {
    borderWidth: 1,
    borderColor: PDF_COLORS.border,
    borderRadius: 4,
    padding: 10,
    marginTop: 6,
    backgroundColor: PDF_COLORS.creamLight,
  },
  bullet: { flexDirection: "row", marginBottom: 2 },
  bulletDot: { width: 10, color: PDF_COLORS.forest },
  bulletText: { flex: 1 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: PDF_COLORS.forest,
    paddingBottom: 3,
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_COLORS.border,
    paddingVertical: 3,
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: PDF_COLORS.forest,
    paddingTop: 4,
    marginTop: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  draft: {
    color: PDF_COLORS.draft,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    marginBottom: 4,
  },
  placeholder: {
    color: PDF_COLORS.draft,
    fontFamily: "Helvetica-Oblique",
    fontSize: 9,
    marginVertical: 2,
  },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 40,
    right: 40,
    fontSize: 7.5,
    color: PDF_COLORS.muted,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signatureImage: { width: 180, height: 60, objectFit: "contain" },
});
