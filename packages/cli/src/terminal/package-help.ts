import type { PackageManifestV1 } from "@modai/contracts/manifest";
import { featureHelpLines, packageFeatureRules } from "@modai/core";

const CONTRIBUTION_LABELS: Record<string, string> = {
  skills: "skill(s)",
  rules: "regla(s)",
  knowledge: "documento(s)",
  tools: "herramienta(s)",
  mcpServers: "servidor(es) MCP",
  components: "componente(s)",
  files: "archivo(s)",
};

function featureNotes(feature: PackageManifestV1["spec"]["features"][string]): string[] {
  const adds = Object.entries(feature.contributes)
    .filter(([, list]) => list.length)
    .map(([key, list]) => `${list.length} ${CONTRIBUTION_LABELS[key] ?? key}`);
  return [
    adds.length ? `añade ${adds.join(", ")}` : "",
    feature.overlays.length
      ? `modifica ${[...new Set(feature.overlays.map((overlay) => overlay.component))].join(", ")}`
      : "",
    Object.keys(feature.dependencies).length ? `instala ${Object.keys(feature.dependencies).join(", ")}` : "",
  ].filter(Boolean);
}

export function packageHelp(manifest: PackageManifestV1, active?: string[]): string {
  const rules = packageFeatureRules(manifest).map((rule) => ({
    ...rule,
    notes: featureNotes(manifest.spec.features[rule.name]!),
  }));
  const { name, version, description } = manifest.metadata;
  return [
    `${name}@${version}`,
    description,
    "",
    `Uso: modai add ${name} [opciones del paquete]`,
    "",
    rules.length
      ? `Opciones de este paquete:\n${featureHelpLines(rules, active).join("\n")}`
      : "Este paquete no declara features: se instala tal cual.",
    ...(rules.length
      ? [
          "",
          "--<feature> la activa y --no-<feature> quita una que viene activa. Cambiarlas después: modai feature enable|disable|reset.",
        ]
      : []),
  ].join("\n");
}
