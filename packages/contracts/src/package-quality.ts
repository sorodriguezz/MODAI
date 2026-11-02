import YAML from "yaml";
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

export function analyzePackageQuality(manifest: PackageManifest, files: ArtifactFile[]): QualityReport {
  const findings: QualityFinding[] = [];
  const dimensions: Record<string, number> = {};
  const content = decodedFiles(files);
  const targets = (manifest.files ?? []).map((item) => item.target.toLocaleLowerCase());
  const corpus = [...content.values()].join("\n").toLocaleLowerCase();

  if (manifest.type === "skill") {
    const skillRule = (manifest.files ?? []).find((item) => item.target.toLocaleLowerCase().endsWith("skill.md"));
    const skill = skillRule ? content.get(skillRule.source) : undefined;
    dimensions.discovery = 0;
    dimensions.instructions = 0;
    dimensions.progressiveDisclosure = 0;
    dimensions.safety = 0;
    dimensions.validation = 0;
    if (!skill) {
      findings.push({ severity: "error", code: "SKILL_ENTRYPOINT_MISSING", message: "Una skill debe instalar un archivo SKILL.md." });
    } else {
      const metadata = frontmatter(skill);
      if (typeof metadata?.name === "string" && /^[a-z0-9-]{1,64}$/.test(metadata.name)) dimensions.discovery += 50;
      else findings.push({ severity: "error", code: "SKILL_NAME_INVALID", message: "SKILL.md necesita un name corto en minúsculas y guiones." });
      if (typeof metadata?.description === "string" && metadata.description.length >= 30 && metadata.description.length <= 400) dimensions.discovery += 50;
      else findings.push({ severity: "warning", code: "SKILL_DESCRIPTION_WEAK", message: "La descripción debe explicar capacidad, activación y límites con precisión." });
      const body = skill.replace(/^---[\s\S]*?---/, "").trim();
      dimensions.instructions = body.length >= 250 && body.length <= 12_000 ? 100 : body.length > 0 ? 50 : 0;
      if (body.length > 12_000) findings.push({ severity: "warning", code: "SKILL_TOO_LARGE", message: "Mueve detalle condicional a references/ para reducir el contexto inicial." });
      const referenceRules = (manifest.files ?? []).filter((item) => item.target.includes("/references/"));
      dimensions.progressiveDisclosure = referenceRules.length ? 100 : body.length < 4_000 ? 80 : 30;
      dimensions.safety = /(alcance|scope|no (?:hagas|modifiques)|autorizaci|destructiv|permiso)/i.test(skill) ? 100 : 60;
      dimensions.validation = /(verifica|validaci|prueba|test|evidencia|criterio)/i.test(skill) ? 100 : 40;
      if (dimensions.validation < 60) findings.push({ severity: "warning", code: "SKILL_NO_VALIDATION", message: "Define evidencia observable o comandos de verificación relevantes." });
    }
  } else if (manifest.type === "harness") {
    dimensions.instructions = targets.some((target) => /(^|\/)(agents|claude)\.md$/.test(target)) ? 100 : 30;
    dimensions.state = targets.some((target) => /(feature.list|progress|state)/.test(target)) ? 100 : 20;
    dimensions.verification = /(verification|definition of done|definici.n de complet|test|check|lint)/i.test(corpus) ? 100 : 20;
    dimensions.scope = /(wip|alcance|scope|blocked|not_started|passing)/i.test(corpus) ? 100 : 30;
    dimensions.lifecycle = targets.some((target) => /(handoff|progress|session)/.test(target)) ? 100 : 20;
    for (const [dimension, score] of Object.entries(dimensions)) {
      if (score < 50) findings.push({ severity: "warning", code: `HARNESS_${dimension.toUpperCase()}_WEAK`, message: `El subsistema ${dimension} no está suficientemente representado.` });
    }
  } else {
    dimensions.manifest = 100;
    dimensions.integrity = 100;
    dimensions.documentation = manifest.description.length >= 30 ? 100 : 60;
  }

  const values = Object.values(dimensions);
  const score = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  if (score >= 80) findings.push({ severity: "info", code: "QUALITY_HIGH", message: "El paquete cumple un nivel estructural alto; valida además su comportamiento con tareas reales." });
  return { score, dimensions, findings };
}
