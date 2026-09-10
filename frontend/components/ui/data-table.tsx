import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The small table shape this app already uses in five places, named once.
 *
 * Deliberately not the full shadcn table primitive: nothing here needs captions, footers or
 * column-header semantics beyond a plain `<th>`, and the results pages add four more tables of
 * exactly this shape. Classes reproduce the hand-rolled originals verbatim so adopting it is a
 * no-op visually.
 */
export function DataTable({
  headers,
  children,
  className,
}: {
  headers: React.ReactNode[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-sm", className)}>
        <thead>
          <tr className="border-b text-muted-foreground">
            {headers.map((header, index) => (
              <th
                key={index}
                className={cn(
                  "py-2 font-medium",
                  index < headers.length - 1 && "pr-3",
                )}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
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
    <tr className={cn("border-b border-border/50 last:border-b-0", className)}>
      {children}
    </tr>
  );
}

/**
 * One cell. `mono` is on by default because almost every cell in this app holds a measured value,
 * and tabular figures are what make a column of them comparable at a glance.
 */
export function DataCell({
  children,
  mono = true,
  last = false,
  className,
  title,
}: {
  children: React.ReactNode;
  mono?: boolean;
  last?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <td
      title={title}
      className={cn(
        "py-1.5",
        !last && "pr-3",
        mono && "font-mono text-xs",
        className,
      )}
    >
      {children}
    </td>
  );
}
