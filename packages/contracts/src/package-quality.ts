import YAML from "yaml";
import { packageManifestV1Schema } from "./spec-v1.js";
import type { ArtifactFile, PackageManifest, QualityFinding, QualityReport } from "./types.js";

function decodedFiles(files: ArtifactFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.path, Buffer.from(file.content, "base64").toString("utf8")]));
}

function frontmatter(content: string): Record<string, unknown> | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  try {
    return YAML.parse(match[1]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function analyzeSkill(
  skill: string,
  hasReferences: boolean,
  findings: QualityFinding[],
  dimensions: Record<string, number>,
  label = "",
): void {
  const metadata = frontmatter(skill);
  let discovery = 0;
  if (typeof metadata?.name === "string" && /^[a-z0-9-]{1,64}$/.test(metadata.name)) discovery += 50;
  else
    findings.push({
      severity: "error",
      code: "SKILL_NAME_INVALID",
      message: `${label}SKILL.md necesita un name corto en minúsculas y guiones.`,
    });
  if (
    typeof metadata?.description === "string" &&
    metadata.description.length >= 30 &&
    metadata.description.length <= 400
  )
    discovery += 50;
  else
    findings.push({
      severity: "warning",
      code: "SKILL_DESCRIPTION_WEAK",
      message: `${label}La descripción debe explicar capacidad, activación y límites con precisión.`,
    });
  const body = skill.replace(/^---[\s\S]*?---/, "").trim();
  const instructions = body.length >= 250 && body.length <= 12_000 ? 100 : body.length > 0 ? 50 : 0;
  if (body.length > 12_000)
    findings.push({
      severity: "warning",
      code: "SKILL_TOO_LARGE",
      message: `${label}Mueve detalle condicional a references/ para reducir el contexto inicial.`,
    });
  const progressive = hasReferences ? 100 : body.length < 4_000 ? 80 : 30;
  const safety = /(alcance|scope|no (?:hagas|modifiques)|autorizaci|destructiv|permiso)/i.test(skill) ? 100 : 60;
  const validation = /(verifica|validaci|prueba|test|evidencia|criterio)/i.test(skill) ? 100 : 40;
  if (validation < 60)
    findings.push({
      severity: "warning",
      code: "SKILL_NO_VALIDATION",
      message: `${label}Define evidencia observable o comandos de verificación relevantes.`,
    });
  const merge = (key: string, value: number) => {
    dimensions[key] = key in dimensions ? Math.min(dimensions[key], value) : value;
  };
  merge("discovery", discovery);
  merge("instructions", instructions);
  merge("progressiveDisclosure", progressive);
  merge("safety", safety);
  merge("validation", validation);
}

/** Quality is computed from contributions and contracts; categories never change the rubric. */
function analyzeV1(raw: unknown, files: ArtifactFile[]): QualityReport {
  const findings: QualityFinding[] = [];
  const dimensions: Record<string, number> = {};
  const parsed = packageManifestV1Schema.safeParse(raw);
  if (!parsed.success)
    return {
      score: 0,
      dimensions: { manifest: 0 },
      findings: [
        {
          severity: "error",
          code: "INVALID_MANIFEST",
          message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        },
      ],
    };
  const manifest = parsed.data;
  const content = decodedFiles(files);
  const { contributes } = manifest.spec;
  dimensions.manifest = 100;
  dimensions.documentation = manifest.metadata.description.length >= 30 ? 100 : 60;
  if (dimensions.documentation < 100)
    findings.push({
      severity: "warning",
      code: "DESCRIPTION_SHORT",
      message: `La descripción tiene ${manifest.metadata.description.length} caracteres: con 30 o más (qué aporta y cuándo usarlo) la documentación sube de 60 a 100.`,
    });
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
    analyzeSkill(
      entry,
      [...content.keys()].some((path) => path.startsWith(`${base}references/`)),
      findings,
      dimensions,
      `${skill.name}: `,
    );
  }
  if (contributes.tools.length || contributes.mcpServers.length) {
    dimensions.contracts =
      manifest.spec.provides.length || contributes.tools.some((tool) => tool.implements) ? 100 : 50;
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

export function analyzePackageQuality(manifest: PackageManifest, files: ArtifactFile[]): QualityReport {
  return analyzeV1(manifest, files);
}
