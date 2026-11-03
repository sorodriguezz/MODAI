import { invariant } from "@modai/contracts/errors";
import { assertSafeRelativePath, requiredTargetPermission } from "@modai/contracts/security";
import { componentTargetPermission } from "../installation/targets.js";
import { componentFiles, packageFileReferences, skillFiles } from "./contribution-files.js";
import type { FeatureContributions, PackageValidation } from "./package-validation.js";

function assertUnique(kind: string, names: string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    invariant(!seen.has(name), 400, "DUPLICATE_CONTRIBUTION", `${kind} duplicado: ${name}`);
    seen.add(name);
  }
}

export function assertUniqueContributionNames(all: FeatureContributions[]): void {
  assertUnique(
    "Skill",
    all.flatMap((item) => item.skills.map((entry) => entry.name)),
  );
  assertUnique(
    "Regla",
    all.flatMap((item) => item.rules.map((entry) => entry.name)),
  );
  assertUnique(
    "Herramienta",
    all.flatMap((item) => item.tools.map((entry) => entry.name)),
  );
  assertUnique(
    "Servidor MCP",
    all.flatMap((item) => item.mcpServers.map((entry) => entry.name)),
  );
  assertUnique(
    "Componente",
    all.flatMap((item) => item.components.map((entry) => entry.name)),
  );
}

type Label = (text: string) => string;

function checkComponentsAndSkills(validation: PackageValidation, contributes: FeatureContributions, label: Label) {
  for (const component of contributes.components) {
    assertSafeRelativePath(component.path, "components.path");
    const entries = componentFiles(component, validation.manifest.metadata.name, validation.paths);
    invariant(
      entries.length > 0,
      400,
      "COMPONENT_EMPTY",
      label(`El componente ${component.name} no tiene archivos en ${component.path}`),
    );
    for (const entry of entries) componentTargetPermission(entry.target);
    validation.requirePermission("project.source", label(`El componente ${component.name}`));
  }
  for (const skill of contributes.skills) {
    const entries = skillFiles(skill, validation.paths);
    invariant(
      entries.some((entry) => entry.relative === "SKILL.md"),
      400,
      "SKILL_ENTRYPOINT_MISSING",
      label(`La skill ${skill.name} necesita ${skill.path}/SKILL.md`),
    );
    for (const entry of entries) validation.exists(entry.source, "skills.path");
  }
}

function checkExecutables(validation: PackageValidation, contributes: FeatureContributions, label: Label) {
  const { requirePermission, exists } = validation;
  for (const rule of contributes.files) {
    exists(rule.source, "files.source");
    const permission = requiredTargetPermission(rule.target);
    if (permission) requirePermission(permission, label(`El destino ${rule.target}`));
    if (rule.executable) requirePermission("process.execute", label("Un archivo ejecutable"));
  }
  for (const tool of contributes.tools) {
    requirePermission("process.execute", label(`La herramienta ${tool.name}`));
    if (tool.envKeys.length)
      requirePermission("env.read", label(`La herramienta ${tool.name} con variables de entorno`));
    for (const reference of packageFileReferences([tool.command, ...tool.args]))
      exists(reference, `tools.${tool.name}`);
  }
  for (const server of contributes.mcpServers) {
    requirePermission("mcp.connect", label(`El servidor MCP ${server.name}`));
    for (const reference of packageFileReferences([server.command, ...server.args]))
      exists(reference, `mcpServers.${server.name}`);
  }
}

export function checkContributions(validation: PackageValidation, contributes: FeatureContributions, where: string) {
  const label = (text: string) => (where ? `${text} (feature ${where})` : text);
  checkComponentsAndSkills(validation, contributes, label);
  for (const rule of contributes.rules) validation.exists(rule.path, "rules.path");
  for (const item of contributes.knowledge) validation.exists(item.path, "knowledge.path");
  checkExecutables(validation, contributes, label);
}
