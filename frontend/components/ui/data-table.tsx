import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one table shape in the app: a header row (or `head` for multi-row headers such as Table 6),
 * thin row rules, no outer box. Numeric cells are right-aligned in tabular figures.
 */
export function DataTable({
  headers,
  head,
  children,
  className,
}: {
  headers?: React.ReactNode[];
  /** Custom `<thead>` rows, for grouped column headers. Takes precedence over `headers`. */
  head?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-sm", className)}>
        <thead className="text-xs text-muted-foreground">
          {head ?? (
            <tr className="border-b border-foreground/20">
              {(headers ?? []).map((header, index) => (
                <DataHead key={index}>{header}</DataHead>
              ))}
            </tr>
          )}
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DataHead({
  children,
  numeric = false,
  colSpan,
  rowSpan,
  className,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  colSpan?: number;
  rowSpan?: number;
  className?: string;
}) {
  return (
    <th
      colSpan={colSpan}
      rowSpan={rowSpan}
      className={cn(
        "px-3 py-2 align-bottom font-medium whitespace-nowrap first:pl-0 last:pr-0",
        numeric && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function DataRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr
      className={cn(
        "border-b border-border/70 transition-colors last:border-b-0 hover:bg-muted/40",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/**
 * One cell. `mono` is on by default because almost every cell holds a measured value; `numeric`
 * also right-aligns it so a column of figures reads at a glance.
 */
export function DataCell({
  children,
  mono = true,
  numeric = false,
  last = false,
  className,
  title,
  colSpan,
}: {
  children: React.ReactNode;
  mono?: boolean;
  numeric?: boolean;
  last?: boolean;
  className?: string;
  title?: string;
  colSpan?: number;
}) {
  return (
    <td
      title={title}
      colSpan={colSpan}
      className={cn(
        "px-3 py-1.5 first:pl-0 last:pr-0",
        last && "pr-0",
        mono && "font-mono text-xs tabular",
        numeric && "text-right whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}
