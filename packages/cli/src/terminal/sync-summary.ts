import type { SyncReport } from "@modai/core";

function writtenGroups(written: string[]): string {
  const groups = new Map<string, number>();
  for (const path of written) {
    const key = path.match(/^(\.[^/]+\/skills\/[^/]+|[^/]+)/)?.[1] ?? path;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([key, count]) => (count > 1 ? `${key}/ (${count})` : key)).join(", ");
}

function installedLine(report: SyncReport): string {
  const names = report.installed.map((item) => `${item.name}@${item.version}`).join(", ");
  return `${report.installed.length} paquete(s) instalados${report.installed.length ? `: ${names}` : ""}.`;
}

export function summarize(report: SyncReport): string {
  const lines = [installedLine(report)];
  if (report.written.length) lines.push(`Escritos: ${writtenGroups(report.written)}`);
  if (report.removed.length) lines.push(`Retirados: ${report.removed.join(", ")}`);
  if (report.preserved.length) lines.push(`Conservados (cambios del usuario): ${report.preserved.join(", ")}`);
  if (report.sideBySide.length)
    lines.push(`Conservé tu versión; la nueva quedó al lado para que la compares: ${report.sideBySide.join(", ")}`);
  for (const warning of report.warnings) lines.push(`Aviso: ${warning}`);
  for (const item of report.missingOptional)
    lines.push(`Opcional sin proveedor: ${item.package} puede usar ${item.capability}@${item.range}`);
  if (report.regrant.length)
    lines.push(
      `Requieren nueva autorización (cambió su contenido o sus features): ${report.regrant.map((name) => `modai permissions grant ${name}`).join("; ")}`,
    );
  return lines.join("\n");
}

export const firstLine = (text: string) => text.split("\n").find((line) => line.trim()) ?? "";
