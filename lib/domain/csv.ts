/**
 * RFC 4180 CSV reader for imports and bulk updates: quoted fields, doubled
 * quotes, commas and line breaks inside quotes, CRLF or LF, a UTF-8 BOM, and
 * trailing empty lines. Pure; writing CSV lives in lib/domain/reports/csv.ts.
 */
export type CsvParse = { header: string[]; rows: string[][]; error: string | null };

export function parseCsv(text: string, options: { maxRows?: number } = {}): CsvParse {
  const maxRows = options.maxRows ?? 5000;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  let quotedField = false;
  const pushField = () => {
    record.push(quotedField ? field : field.trim());
    field = "";
    quotedField = false;
  };
  const pushRecord = () => {
    pushField();
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };
  while (i < src.length) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field.trim() === "") {
      inQuotes = true;
      quotedField = true;
      field = "";
      i += 1;
      continue;
    }
    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (c === "\r" || c === "\n") {
      pushRecord();
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      i += 1;
      if (records.length > maxRows + 1) break;
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes)
    return { header: [], rows: [], error: "A quoted value never ends. Check the file." };
  if (field !== "" || record.length > 0) pushRecord();
  if (records.length === 0) return { header: [], rows: [], error: "The file is empty." };
  const [header, ...rows] = records;
  if (rows.length > maxRows) {
    return {
      header: header!,
      rows: rows.slice(0, maxRows),
      error: `Only the first ${maxRows.toLocaleString("en-US")} rows can be imported at once. Split the file.`,
    };
  }
  const width = header!.length;
  return {
    header: header!.map((h) => h.trim()),
    rows: rows.map((r) =>
      r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill("")],
    ),
    error: null,
  };
}
