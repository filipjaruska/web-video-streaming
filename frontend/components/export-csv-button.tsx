"use client";

import { Download } from "lucide-react";

import { useActionAuth } from "@/components/action-auth-provider";
import { Button } from "@/components/ui/button";
import { downloadCsv, rowsToCsv, type CsvCell } from "@/lib/csvExport";

interface ExportCsvButtonProps {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
  disabled?: boolean;
  label?: string;
}

/** Downloads a table as CSV, behind the site password like every other action. */
export function ExportCsvButton({
  filename,
  headers,
  rows,
  disabled,
  label = "Export CSV",
}: ExportCsvButtonProps) {
  const { requireAuth } = useActionAuth();
  const empty = rows.length === 0;

  async function download() {
    if (await requireAuth()) {
      downloadCsv(filename, rowsToCsv(headers, rows));
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || empty}
      onClick={() => void download()}
    >
      <Download />
      {label}
    </Button>
  );
}
