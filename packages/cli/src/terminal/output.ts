import chalk from "chalk";

type Scalar = string | number | boolean | null | undefined;
export type Row = Record<string, unknown>;

let jsonMode = false;
export function setJsonMode(value: boolean): void {
  jsonMode = value;
}
export function isJsonMode(): boolean {
  return jsonMode;
}

const isScalar = (value: unknown): value is Scalar =>
  value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);
const isFlatObject = (value: unknown): value is Row =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (Array.isArray(value)) return value.map(cell).join(", ");
  if (isFlatObject(value))
    return Object.entries(value)
      .map(([key, item]) => `${key}=${cell(item)}`)
      .join(" ");
  return String(value).replace(/\s+/g, " ");
}

export function formatTable(rows: Row[], maxWidth = 60): string {
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => row[key] !== undefined)))];
  const widths = columns.map((column) =>
    Math.min(maxWidth, Math.max(column.length, ...rows.map((row) => cell(row[column]).length))),
  );
  const fit = (text: string, width: number) =>
    (text.length > width ? `${text.slice(0, width - 1)}…` : text).padEnd(width);
  const header = columns
    .map((column, index) => fit(column.toUpperCase(), widths[index]))
    .join("  ")
    .trimEnd();
  return [
    jsonMode ? header : chalk.bold.dim(header),
    ...rows.map((row) =>
      columns
        .map((column, index) => fit(cell(row[column]), widths[index]))
        .join("  ")
        .trimEnd(),
    ),
  ].join("\n");
}

const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());

function renderList(value: unknown[], indent: string): string {
  if (!value.length) return `${indent}(vacío)`;
  if (value.every(isScalar)) return value.map((item) => `${indent}- ${cell(item)}`).join("\n");
  if (value.every(isFlatObject))
    return formatTable(value)
      .split("\n")
      .map((line) => indent + line)
      .join("\n");
  return value.map((item) => render(item, indent)).join("\n\n");
}

function renderEntry(key: string, item: unknown, indent: string): string[] {
  if (isScalar(item) || (Array.isArray(item) && item.every(isScalar)))
    return [`${indent}${jsonMode ? label(key) : chalk.bold(label(key))}: ${cell(item) || "—"}`];
  if (Array.isArray(item) || Object.keys(item as Row).length)
    return [`${indent}${label(key)}:`, render(item, `${indent}  `)];
  return [`${indent}${label(key)}: —`];
}

export function render(value: unknown, indent = ""): string {
  if (typeof value === "string") return value;
  if (isScalar(value)) return cell(value);
  if (Array.isArray(value)) return renderList(value, indent);
  return Object.entries(value as Row)
    .filter(([, item]) => item !== undefined)
    .flatMap(([key, item]) => renderEntry(key, item, indent))
    .join("\n");
}

export function print(value: unknown): void {
  if (jsonMode)
    process.stdout.write(
      `${JSON.stringify(typeof value === "string" ? { message: value } : (value ?? null), null, 2)}\n`,
    );
  else process.stdout.write(`${render(value)}\n`);
}

export function printList(rows: Row[], empty: string): void {
  if (jsonMode) print(rows);
  else print(rows.length ? formatTable(rows) : empty);
}

export type Print = typeof print;
