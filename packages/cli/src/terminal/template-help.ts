import type { PackageRecord } from "@modai/contracts/types";
import { featureHelpLines, type TemplateManifest } from "@modai/core";

const GENERAL_OPTIONS = [
  "Opciones generales:",
  "  --var clave=valor   Valor para un marcador {{clave}}",
  "  --with <add-on>     Añade otro template como capa (repetible)",
  "  --sync              Instala ya los paquetes MODAI que aportan las features (modai sync)",
  "  --allow <permisos>  Permisos de instalación para --sync (por ejemplo project.source)",
  "  --dry-run           Muestra los archivos sin escribir",
  "  --force             Escribe aunque la carpeta no esté vacía",
  "  -h, --help          Esta ayuda",
];

export function templateHelp(record: PackageRecord, manifest: TemplateManifest): string {
  const features = manifest.features.map((feature) => ({
    ...feature,
    notes: [
      feature.uses ? `usa ${feature.uses}` : "",
      Object.keys(feature.packages).length ? `instala ${Object.keys(feature.packages).join(", ")}` : "",
    ].filter(Boolean),
  }));
  return [
    `${record.name}@${record.version} · ${record.manifest.spec?.category ?? "template"}`,
    record.description,
    "",
    `Uso: modai template use ${record.name} [carpeta] [opciones]`,
    "",
    features.length
      ? `Opciones de este template:\n${featureHelpLines(features).join("\n")}`
      : "Este template no declara features: se crea tal cual.",
    ...(manifest.addon
      ? [
          "",
          `Es un add-on${manifest.addon.for.length ? ` para ${manifest.addon.for.join(", ")}` : ""}: se combina con otro template usando --with ${record.name}.`,
        ]
      : []),
    "",
    ...GENERAL_OPTIONS,
  ].join("\n");
}
