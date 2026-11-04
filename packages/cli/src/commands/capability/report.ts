import { type InstalledPackage, inspectWorkspace, loadV1Project } from "@modai/core";

const enabled = (item: InstalledPackage) => item.authorization.allowed && item.verified;

export function toolRows(installed: InstalledPackage[]) {
  return installed.flatMap((item) =>
    item.manifest.spec.contributes.tools.map((tool) => ({
      tool: tool.name,
      package: item.name,
      implements: tool.implements,
      authorized: enabled(item),
      ...(item.authorization.allowed ? {} : { reason: item.authorization.reason }),
    })),
  );
}

export function capabilityReport(root: string) {
  const project = loadV1Project(root);
  const installed = inspectWorkspace(project);
  return {
    provided: project.lock.capabilities,
    required: Object.fromEntries(
      Object.entries(project.lock.packages)
        .filter(([, item]) => Object.keys(item.requires).length)
        .map(([name, item]) => [name, item.requires]),
    ),
    tools: toolRows(installed),
    mcpServers: installed.flatMap((item) =>
      item.manifest.spec.contributes.mcpServers.map((server) => ({
        server: server.name,
        package: item.name,
        authorized: enabled(item),
      })),
    ),
    skills: installed.flatMap((item) =>
      item.manifest.spec.contributes.skills.map((skill) => ({ skill: skill.name, package: item.name })),
    ),
  };
}
