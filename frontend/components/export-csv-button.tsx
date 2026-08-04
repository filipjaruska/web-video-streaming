"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv, rowsToCsv, type CsvCell } from "@/lib/csvExport";

interface ExportCsvButtonProps {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
  disabled?: boolean;
  label?: string;
}

export function ExportCsvButton({
  filename,
  headers,
  rows,
  disabled,
  label = "Export CSV",
}: ExportCsvButtonProps) {
  const empty = rows.length === 0;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || empty}
      onClick={() => downloadCsv(filename, rowsToCsv(headers, rows))}
    >
      <Download />
      {label}
    </Button>
  );
}
