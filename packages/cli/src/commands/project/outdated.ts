import { CompositeRegistry, loadV1Project } from "@modai/core";
import type { Command } from "commander";
import semver from "semver";
import { withMaterializedProfile } from "../../services/profile.js";
import { requireProject } from "../../services/project.js";
import { projectRegistry } from "../../services/registries.js";
import type { Print } from "../../terminal/output.js";

async function outdatedRows(root: string) {
  const project = loadV1Project(root);
  const effective = await withMaterializedProfile(project.file, projectRegistry(project).registries);
  const registry = new CompositeRegistry(effective.registries);
  const rows = [];
  for (const [name, locked] of Object.entries(project.lock.packages)) {
    if (locked.source.startsWith("file:")) {
      rows.push({ name, current: locked.version, latest: locked.version, source: locked.source, outdated: false });
      continue;
    }
    const versions = (await registry.versions(name))
      .filter((item) => item.status !== "yanked")
      .map((item) => item.version)
      .sort(semver.rcompare);
    const latest = versions[0] ?? locked.version;
    rows.push({
      name,
      current: locked.version,
      latest,
      wanted: effective.file.dependencies[name] ?? "(transitiva)",
      outdated: semver.lt(locked.version, latest),
    });
  }
  return rows;
}

export function registerOutdated(program: Command, print: Print): void {
  program
    .command("outdated")
    .description("Compara el lock con las versiones disponibles en los registries")
    .action(async () => print(await outdatedRows(requireProject())));
}
