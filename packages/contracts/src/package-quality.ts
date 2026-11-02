import YAML from "yaml";
import { isV1Manifest, type AnyPackageManifest, type ArtifactFile, type PackageManifest, type QualityFinding, type QualityReport } from "./types.js";
import { packageManifestV1Schema } from "./spec-v1.js";

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

function analyzeSkill(skill: string, hasReferences: boolean, findings: QualityFinding[], dimensions: Record<string, number>, label = ""): void {
  const metadata = frontmatter(skill);
  let discovery = 0;
  if (typeof metadata?.name === "string" && /^[a-z0-9-]{1,64}$/.test(metadata.name)) discovery += 50;
  else findings.push({ severity: "error", code: "SKILL_NAME_INVALID", message: `${label}SKILL.md necesita un name corto en minúsculas y guiones.` });
  if (typeof metadata?.description === "string" && metadata.description.length >= 30 && metadata.description.length <= 400) discovery += 50;
  else findings.push({ severity: "warning", code: "SKILL_DESCRIPTION_WEAK", message: `${label}La descripción debe explicar capacidad, activación y límites con precisión.` });
  const body = skill.replace(/^---[\s\S]*?---/, "").trim();
  const instructions = body.length >= 250 && body.length <= 12_000 ? 100 : body.length > 0 ? 50 : 0;
  if (body.length > 12_000) findings.push({ severity: "warning", code: "SKILL_TOO_LARGE", message: `${label}Mueve detalle condicional a references/ para reducir el contexto inicial.` });
  const progressive = hasReferences ? 100 : body.length < 4_000 ? 80 : 30;
  const safety = /(alcance|scope|no (?:hagas|modifiques)|autorizaci|destructiv|permiso)/i.test(skill) ? 100 : 60;
  const validation = /(verifica|validaci|prueba|test|evidencia|criterio)/i.test(skill) ? 100 : 40;
  if (validation < 60) findings.push({ severity: "warning", code: "SKILL_NO_VALIDATION", message: `${label}Define evidencia observable o comandos de verificación relevantes.` });
  const merge = (key: string, value: number) => { dimensions[key] = key in dimensions ? Math.min(dimensions[key], value) : value; };
  merge("discovery", discovery); merge("instructions", instructions); merge("progressiveDisclosure", progressive); merge("safety", safety); merge("validation", validation);
}

/** v1 quality is computed from contributions and contracts; categories never change the rubric. */
function analyzeV1(raw: unknown, files: ArtifactFile[]): QualityReport {
  const findings: QualityFinding[] = [];
  const dimensions: Record<string, number> = {};
  const parsed = packageManifestV1Schema.safeParse(raw);
  if (!parsed.success) return { score: 0, dimensions: { manifest: 0 }, findings: [{ severity: "error", code: "INVALID_MANIFEST", message: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ") }] };
  const manifest = parsed.data;
  const content = decodedFiles(files);
  const { contributes } = manifest.spec;
  dimensions.manifest = 100;
  dimensions.documentation = manifest.metadata.description.length >= 30 ? 100 : 60;
  for (const skill of contributes.skills) {
    const base = skill.path === "." ? "" : `${skill.path}/`;
    const entry = content.get(`${base}SKILL.md`);
    if (!entry) { findings.push({ severity: "error", code: "SKILL_ENTRYPOINT_MISSING", message: `La skill ${skill.name} necesita SKILL.md.` }); continue; }
    analyzeSkill(entry, [...content.keys()].some(path => path.startsWith(`${base}references/`)), findings, dimensions, `${skill.name}: `);
  }
  if (contributes.tools.length || contributes.mcpServers.length) {
    dimensions.contracts = manifest.spec.provides.length || contributes.tools.some(tool => tool.implements) ? 100 : 50;
    if (dimensions.contracts < 100) findings.push({ severity: "warning", code: "CAPABILITY_UNDECLARED", message: "Declara spec.provides o tools[].implements para que otros paquetes dependan del contrato y no de este paquete." });
    const schemaless = contributes.tools.filter(tool => !Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}).length && tool.inputSchema.additionalProperties !== false);
    dimensions.toolSafety = schemaless.length ? 60 : 100;
    if (schemaless.length) findings.push({ severity: "warning", code: "TOOL_SCHEMA_OPEN", message: `Restringe inputSchema de: ${schemaless.map(tool => tool.name).join(", ")}.` });
  }
  if (manifest.kind === "Profile" && !Object.keys(manifest.spec.dependencies).length) findings.push({ severity: "warning", code: "PROFILE_EMPTY", message: "Un perfil debería componer dependencias." });
  const values = Object.values(dimensions);
  const score = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  if (score >= 80) findings.push({ severity: "info", code: "QUALITY_HIGH", message: "El paquete cumple un nivel estructural alto; valida además su comportamiento con tareas reales." });
  return { score, dimensions, findings };
}

export function analyzePackageQuality(anyManifest: AnyPackageManifest, files: ArtifactFile[]): QualityReport {
  if (isV1Manifest(anyManifest)) return analyzeV1(anyManifest, files);
  const manifest = anyManifest as PackageManifest;
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
