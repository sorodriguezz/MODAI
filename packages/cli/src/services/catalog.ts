import type { PackageManifestV1 } from "@modai/contracts/manifest";
import { availableAdapters, BUILTIN_ADAPTERS, expandTemplate, inspectWorkspace, normalizeManifest } from "@modai/core";
import { currentProject } from "./project.js";
import { availableRegistry } from "./registries.js";

export type ListRow = Record<string, string | number | boolean | undefined>;
export interface Entry {
  name: string;
  version: string;
  manifest: PackageManifestV1;
  installed: boolean;
  registry?: string;
}

const CONTRIBUTIONS: Record<string, { aliases: string[]; rows: (entry: Entry) => ListRow[] }> = {
  skills: {
    aliases: ["skill"],
    rows: (e) =>
      e.manifest.spec.contributes.skills.map((item) => ({
        skill: item.name,
        package: e.name,
        version: e.version,
        path: item.path,
      })),
  },
  rules: {
    aliases: ["rule", "reglas"],
    rows: (e) =>
      e.manifest.spec.contributes.rules.map((item) => ({
        rule: item.name,
        package: e.name,
        version: e.version,
        description: item.description,
      })),
  },
  knowledge: {
    aliases: ["conocimiento", "docs"],
    rows: (e) =>
      e.manifest.spec.contributes.knowledge.map((item) => ({
        title: item.title,
        package: e.name,
        version: e.version,
        path: item.path,
      })),
  },
  tools: {
    aliases: ["tool", "herramientas"],
    rows: (e) =>
      e.manifest.spec.contributes.tools.map((item) => ({
        tool: item.name,
        package: e.name,
        version: e.version,
        implements: item.implements,
        description: item.description,
      })),
  },
  mcp: {
    aliases: ["mcp-servers", "mcpservers", "servers"],
    rows: (e) =>
      e.manifest.spec.contributes.mcpServers.map((item) => ({
        server: item.name,
        package: e.name,
        version: e.version,
        command: `${item.command} ${item.args.join(" ")}`.trim(),
      })),
  },
  agents: {
    aliases: ["agent", "agentes"],
    rows: (e) =>
      e.manifest.spec.contributes.agents.map((item) => ({ agent: item.name, package: e.name, version: e.version })),
  },
  components: {
    aliases: ["component", "componentes", "modules", "modulos"],
    rows: (e) =>
      e.manifest.spec.contributes.components.map((item) => ({
        component: item.name,
        package: e.name,
        version: e.version,
        target: expandTemplate(item.target, { component: item.name, package: e.name }),
        language: item.language,
        description: item.description,
      })),
  },
  files: {
    aliases: ["file", "archivos"],
    rows: (e) =>
      e.manifest.spec.contributes.files.map((item) => ({ target: item.target, package: e.name, version: e.version })),
  },
};
const KINDS: Record<string, string> = {
  profiles: "Profile",
  profile: "Profile",
  perfiles: "Profile",
  templates: "Template",
  template: "Template",
  plantillas: "Template",
};
const CATEGORY_ALIASES: Record<string, string> = { harnesses: "harness", arneses: "harness", components: "component" };
export const LIST_TYPES = [
  "packages",
  ...Object.keys(CONTRIBUTIONS),
  "profiles",
  "templates",
  "adapters",
  "registries",
  "capabilities",
  "<categoría>",
];

function packageRow(entry: Entry): ListRow {
  return {
    package: entry.name,
    version: entry.version,
    kind: entry.manifest.kind,
    category: entry.manifest.spec.category,
    ...(entry.registry ? { registry: entry.registry, installed: entry.installed } : {}),
    description: entry.manifest.metadata.description,
  };
}

export function listRows(type: string, entries: Entry[]): { rows: ListRow[]; matched: string } {
  const what = type.toLowerCase();
  if (["", "packages", "package", "paquetes", "all"].includes(what))
    return { rows: entries.map(packageRow), matched: "packages" };
  const contribution = Object.entries(CONTRIBUTIONS).find(
    ([key, value]) => key === what || value.aliases.includes(what),
  );
  if (contribution) return { rows: entries.flatMap(contribution[1].rows), matched: contribution[0] };
  if (KINDS[what])
    return {
      rows: entries.filter((entry) => entry.manifest.kind === KINDS[what]).map(packageRow),
      matched: KINDS[what],
    };
  const category = CATEGORY_ALIASES[what] ?? what.replace(/s$/, "");
  return {
    rows: entries.filter((entry) => [what, category].includes(entry.manifest.spec.category)).map(packageRow),
    matched: `category:${category}`,
  };
}

export interface EntryOptions {
  available?: boolean;
  registry?: string;
  query?: string;
}

async function publishedEntries(options: EntryOptions): Promise<Entry[]> {
  const installed = currentProject()?.lock.packages ?? {};
  const list = await availableRegistry(options).list(options.query);
  return list.flatMap((item) => {
    try {
      return [
        {
          name: item.name,
          version: item.version,
          manifest: normalizeManifest(item.manifest),
          installed: installed[item.name]?.version === item.version,
          registry: item.registry,
        },
      ];
    } catch {
      return [];
    }
  });
}

export async function catalogEntries(options: EntryOptions): Promise<Entry[]> {
  if (options.available || options.registry) return publishedEntries(options);
  const project = currentProject();
  if (!project)
    throw new Error(
      "No es un proyecto MODAI: ejecuta 'modai init', o usa --available para listar lo publicado en los registries.",
    );
  const query = options.query?.toLowerCase();
  return inspectWorkspace(project)
    .filter((item) => !query || `${item.name} ${item.manifest.metadata.description}`.toLowerCase().includes(query))
    .map((item) => ({ name: item.name, version: item.version, manifest: item.manifest, installed: true }));
}

export async function availableEntries(
  query?: string,
): Promise<Array<{ name: string; version: string; manifest: PackageManifestV1 }>> {
  return catalogEntries({ available: true, query });
}

export function adapterRows() {
  const project = currentProject();
  const installed = project
    ? inspectWorkspace(project).map((item) => ({ name: item.name, manifest: item.manifest }))
    : [];
  return installed.length
    ? availableAdapters(installed)
    : BUILTIN_ADAPTERS.map((definition) => ({ definition, source: "builtin" }));
}
