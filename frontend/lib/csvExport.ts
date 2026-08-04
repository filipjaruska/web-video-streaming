export type CsvCell = string | number | boolean | null | undefined;

/** Escape a single CSV field (RFC 4180-ish). */
export function csvEscape(value: CsvCell): string {
  if (value == null) {
    return "";
  }
  const text = typeof value === "number"
    ? Number.isFinite(value)
      ? String(value)
      : ""
    : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function rowsToCsv(
  headers: string[],
  rows: CsvCell[][],
): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => row.map(csvEscape).join(",")),
  ];
  // BOM helps Excel open UTF-8 correctly
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function slugFilename(parts: string[]): string {
  const slug = parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "export";
}
