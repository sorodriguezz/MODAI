// Every command prints through here: readable text by default, machine output with the global --json.
import chalk from "chalk";

type Scalar = string | number | boolean | null | undefined;
export type Row = Record<string, unknown>;

let jsonMode = false;
export function setJsonMode(value: boolean): void { jsonMode = value; }
export function isJsonMode(): boolean { return jsonMode; }

const isScalar = (value: unknown): value is Scalar => value === null || ["string", "number", "boolean", "undefined"].includes(typeof value);
const isFlatObject = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (Array.isArray(value)) return value.map(cell).join(", ");
  if (isFlatObject(value)) return Object.entries(value).map(([key, item]) => `${key}=${cell(item)}`).join(" ");
  return String(value).replace(/\s+/g, " ");
}

/** Plain-text table; long cells are truncated so a listing stays readable in a terminal. */
export function formatTable(rows: Row[], maxWidth = 60): string {
  if (!rows.length) return "";
  const columns = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => row[key] !== undefined)))];
  const widths = columns.map(column => Math.min(maxWidth, Math.max(column.length, ...rows.map(row => cell(row[column]).length))));
  const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text).padEnd(width);
  // Colors go on after padding, so escape codes never count towards a column's width.
  const header = columns.map((column, index) => fit(column.toUpperCase(), widths[index])).join("  ").trimEnd();
  return [jsonMode ? header : chalk.bold.dim(header), ...rows.map(row => columns.map((column, index) => fit(cell(row[column]), widths[index])).join("  ").trimEnd())].join("\n");
}

const label = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, char => char.toUpperCase());

/** Human rendering of any command result: lists become tables, objects become labelled sections. */
export function render(value: unknown, indent = ""): string {
  if (typeof value === "string") return value;
  if (isScalar(value)) return cell(value);
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}(vacío)`;
    if (value.every(isScalar)) return value.map(item => `${indent}- ${cell(item)}`).join("\n");
    if (value.every(isFlatObject)) return formatTable(value).split("\n").map(line => indent + line).join("\n");
    return value.map(item => render(item, indent)).join("\n\n");
  }
  const lines: string[] = [];
  for (const [key, item] of Object.entries(value as Row)) {
    if (item === undefined) continue;
    if (isScalar(item) || (Array.isArray(item) && item.every(isScalar))) lines.push(`${indent}${jsonMode ? label(key) : chalk.bold(label(key))}: ${cell(item) || "—"}`);
    else if (Array.isArray(item) || Object.keys(item as Row).length) lines.push(`${indent}${label(key)}:`, render(item, `${indent}  `));
    else lines.push(`${indent}${label(key)}: —`);
  }
  return lines.join("\n");
}

export function print(value: unknown): void {
  if (jsonMode) process.stdout.write(`${JSON.stringify(typeof value === "string" ? { message: value } : value ?? null, null, 2)}\n`);
  else process.stdout.write(`${render(value)}\n`);
}

/** For listings that print a friendly sentence instead of an empty table (but [] in JSON). */
export function printList(rows: Row[], empty: string): void {
  if (jsonMode) print(rows);
  else print(rows.length ? formatTable(rows) : empty);
}

export type Print = typeof print;
