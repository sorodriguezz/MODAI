import { AppError } from "@modai/contracts/errors";
import { requiredTargetPermission } from "@modai/contracts/security";
import { componentFiles, skillFiles } from "../packages/contribution-files.js";
import { type AvailableAdapter, DEFAULT_MCP_VALUE } from "./adapters.js";
import { renderCapabilityIndex } from "./capability-index.js";
import type { DesiredBlock, DesiredFile, DesiredJson, DesiredState, InstallUnit } from "./desired-state.js";
import { adapterTargetPermission, assertWritableTarget, componentTargetPermission, expandTemplate } from "./targets.js";

type Rule = InstallUnit["manifest"]["spec"]["contributes"]["rules"][number];

class ContributionPlan {
  readonly files = new Map<string, DesiredFile>();
  readonly blocks = new Map<string, DesiredBlock>();
  readonly json = new Map<string, DesiredJson>();
  readonly rulesByBlock = new Map<string, { adapter: string; sections: string[]; owners: Set<string> }>();
  readonly skillLocation = new Map<string, string>();

  addFile(file: DesiredFile): void {
    const key = file.path.toLowerCase();
    const existing = this.files.get(key);
    if (existing && (existing.owner !== file.owner || !existing.content.equals(file.content)))
      throw new AppError(
        409,
        "TARGET_COLLISION",
        `Colisión: ${existing.owner} y ${file.owner} administran ${file.path}`,
      );
    this.files.set(key, file);
  }

  addBlock(block: DesiredBlock): void {
    const key = `${block.path.toLowerCase()}#${block.id}`;
    const existing = this.blocks.get(key);
    if (!existing) {
      this.blocks.set(key, block);
      return;
    }
    if (existing.content !== block.content)
      throw new AppError(
        409,
        "TARGET_COLLISION",
        `Los adaptadores ${existing.adapter} y ${block.adapter} escriben bloques distintos en ${block.path}`,
      );
  }
}

function planRawFiles(plan: ContributionPlan, unit: InstallUnit): void {
  const { contributes } = unit.manifest.spec;
  for (const rule of contributes.files) {
    const path = assertWritableTarget(rule.target);
    plan.addFile({
      path,
      content: unit.files.get(rule.source)!,
      owner: unit.name,
      executable: Boolean(rule.executable),
      permission: requiredTargetPermission(path),
    });
  }
  for (const component of contributes.components)
    for (const entry of componentFiles(component, unit.name, unit.files.keys()))
      plan.addFile({
        path: assertWritableTarget(entry.target),
        content: unit.files.get(entry.source)!,
        owner: unit.name,
        executable: false,
        permission: componentTargetPermission(entry.target),
      });
}

function planSkills(plan: ContributionPlan, unit: InstallUnit, adapters: AvailableAdapter[]): void {
  const skillAdapter = adapters.find((adapter) => adapter.definition.targets.skills);
  for (const skill of unit.manifest.spec.contributes.skills)
    for (const adapter of adapters) {
      const template = adapter.definition.targets.skills?.path;
      if (!template) continue;
      const directory = expandTemplate(template, { skill: skill.name, package: unit.name });
      if (adapter === skillAdapter) plan.skillLocation.set(`${unit.name}:${skill.name}`, `${directory}/SKILL.md`);
      for (const entry of skillFiles(skill, unit.files.keys())) {
        const path = `${directory}/${entry.relative}`;
        plan.addFile({
          path: assertWritableTarget(path),
          content: unit.files.get(entry.source)!,
          owner: unit.name,
          adapter: adapter.definition.id,
          executable: false,
          permission: adapterTargetPermission(path),
        });
      }
    }
}

function planRule(
  plan: ContributionPlan,
  unit: InstallUnit,
  rule: Rule,
  content: string,
  adapter: AvailableAdapter,
): void {
  const target = adapter.definition.targets.rules;
  if (!target) return;
  if (target.mode === "file") {
    const path = expandTemplate(target.path, { package: unit.name, rule: rule.name });
    const header = target.header ? `${target.header.replaceAll("{description}", rule.description ?? rule.name)}\n` : "";
    plan.addFile({
      path: assertWritableTarget(path),
      content: Buffer.from(`${header}${content}\n`),
      owner: unit.name,
      adapter: adapter.definition.id,
      executable: false,
      permission: adapterTargetPermission(path),
    });
    return;
  }
  const key = assertWritableTarget(target.file);
  const entry = plan.rulesByBlock.get(key) ?? { adapter: adapter.definition.id, sections: [], owners: new Set() };
  entry.sections.push(`### ${rule.name} · ${unit.name}\n\n${content}`);
  entry.owners.add(unit.name);
  plan.rulesByBlock.set(key, entry);
}

function planRuleBlocks(plan: ContributionPlan): void {
  for (const [path, entry] of plan.rulesByBlock)
    plan.addBlock({
      path,
      id: "rules",
      adapter: entry.adapter,
      owners: [...entry.owners].sort(),
      permission: adapterTargetPermission(path),
      content: `## Reglas instaladas por MODAI\n\n${entry.sections.join("\n\n")}`,
    });
}

function planAdapterTargets(plan: ContributionPlan, units: InstallUnit[], adapters: AvailableAdapter[]): void {
  const index = renderCapabilityIndex(units, plan.skillLocation);
  for (const adapter of adapters) {
    const { index: indexTarget, mcp } = adapter.definition.targets;
    if (indexTarget && index)
      plan.addBlock({
        path: assertWritableTarget(indexTarget.file),
        id: "index",
        content: index,
        owners: units.map((unit) => unit.name),
        adapter: adapter.definition.id,
        permission: adapterTargetPermission(indexTarget.file),
      });
    if (!mcp) continue;
    const path = assertWritableTarget(mcp.file);
    const key = `${path.toLowerCase()}#${mcp.pointer}`;
    if (!plan.json.has(key))
      plan.json.set(key, {
        path,
        pointer: mcp.pointer,
        value: mcp.value ?? DEFAULT_MCP_VALUE,
        adapter: adapter.definition.id,
        permission: adapterTargetPermission(path),
      });
  }
}

export function planContributions(units: InstallUnit[], adapters: AvailableAdapter[]): DesiredState {
  const plan = new ContributionPlan();
  for (const unit of units) {
    planRawFiles(plan, unit);
    planSkills(plan, unit, adapters);
    for (const rule of unit.manifest.spec.contributes.rules) {
      const content = unit.files.get(rule.path)!.toString("utf8").trim();
      for (const adapter of adapters) planRule(plan, unit, rule, content, adapter);
    }
  }
  planRuleBlocks(plan);
  planAdapterTargets(plan, units, adapters);
  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path);
  return {
    files: [...plan.files.values()].sort(byPath),
    blocks: [...plan.blocks.values()].sort(byPath),
    json: [...plan.json.values()].sort(byPath),
  };
}
