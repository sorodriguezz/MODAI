import { type PackageManifestV1, packageManifestV1Schema } from "../manifest/package.js";
import type { ArtifactFile, PackageManifest, QualityFinding, QualityReport } from "../types.js";
import { analyzeSkill } from "./skill-quality.js";

type Contributions = PackageManifestV1["spec"]["contributes"];

function decodedFiles(files: ArtifactFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.path, Buffer.from(file.content, "base64").toString("utf8")]));
}

function invalidManifestReport(issues: Array<{ path: PropertyKey[]; message: string }>): QualityReport {
  return {
    score: 0,
    dimensions: { manifest: 0 },
    findings: [
      {
        severity: "error",
        code: "INVALID_MANIFEST",
        message: issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      },
    ],
  };
}

function analyzeSkills(
  contributes: Contributions,
  content: Map<string, string>,
  findings: QualityFinding[],
  dimensions: Record<string, number>,
): void {
  for (const skill of contributes.skills) {
    const base = skill.path === "." ? "" : `${skill.path}/`;
    const entry = content.get(`${base}SKILL.md`);
    if (!entry) {
      findings.push({
        severity: "error",
        code: "SKILL_ENTRYPOINT_MISSING",
        message: `La skill ${skill.name} necesita SKILL.md.`,
      });
      continue;
    }
    const hasReferences = [...content.keys()].some((path) => path.startsWith(`${base}references/`));
    analyzeSkill(entry, hasReferences, findings, dimensions, `${skill.name}: `);
  }
}

function analyzeTools(
  manifest: PackageManifestV1,
  findings: QualityFinding[],
  dimensions: Record<string, number>,
): void {
  const { contributes } = manifest.spec;
  if (!contributes.tools.length && !contributes.mcpServers.length) return;
  dimensions.contracts = manifest.spec.provides.length || contributes.tools.some((tool) => tool.implements) ? 100 : 50;
  if (dimensions.contracts < 100)
    findings.push({
      severity: "warning",
      code: "CAPABILITY_UNDECLARED",
      message:
        "Declara spec.provides o tools[].implements para que otros paquetes dependan del contrato y no de este paquete.",
    });
  const schemaless = contributes.tools.filter(
    (tool) =>
      !Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}).length &&
      tool.inputSchema.additionalProperties !== false,
  );
  dimensions.toolSafety = schemaless.length ? 60 : 100;
  if (schemaless.length)
    findings.push({
      severity: "warning",
      code: "TOOL_SCHEMA_OPEN",
      message: `Restringe inputSchema de: ${schemaless.map((tool) => tool.name).join(", ")}.`,
    });
}

function analyzeDocumentation(
  manifest: PackageManifestV1,
  findings: QualityFinding[],
  dimensions: Record<string, number>,
): void {
  dimensions.manifest = 100;
  dimensions.documentation = manifest.metadata.description.length >= 30 ? 100 : 60;
  if (dimensions.documentation < 100)
    findings.push({
      severity: "warning",
      code: "DESCRIPTION_SHORT",
      message: `La descripción tiene ${manifest.metadata.description.length} caracteres: con 30 o más (qué aporta y cuándo usarlo) la documentación sube de 60 a 100.`,
    });
}

export function analyzePackageQuality(raw: PackageManifest, files: ArtifactFile[]): QualityReport {
  const parsed = packageManifestV1Schema.safeParse(raw);
  if (!parsed.success) return invalidManifestReport(parsed.error.issues);
  const manifest = parsed.data;
  const findings: QualityFinding[] = [];
  const dimensions: Record<string, number> = {};
  analyzeDocumentation(manifest, findings, dimensions);
  analyzeSkills(manifest.spec.contributes, decodedFiles(files), findings, dimensions);
  analyzeTools(manifest, findings, dimensions);
  if (manifest.kind === "Profile" && !Object.keys(manifest.spec.dependencies).length)
    findings.push({ severity: "warning", code: "PROFILE_EMPTY", message: "Un perfil debería componer dependencias." });
  const values = Object.values(dimensions);
  const score = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  if (score >= 80)
    findings.push({
      severity: "info",
      code: "QUALITY_HIGH",
      message: "El paquete cumple un nivel estructural alto; valida además su comportamiento con tareas reales.",
    });
  return { score, dimensions, findings };
}
