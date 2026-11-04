import type { PackageRecord } from "@modai/contracts/types";
import { normalizeManifest } from "@modai/core";
import type { PackageReader } from "../auth/authorization.service.js";
import type { PackagesService } from "./packages.service.js";

type Manifest = ReturnType<typeof normalizeManifest>;

export interface CatalogOptions {
  q?: string;
  type?: string;
  category?: string;
  status?: string;
  limit?: number;
  offset?: number;
  visible?: PackageReader;
}

const CATALOG_TYPES: Record<string, (manifest: Manifest) => boolean> = {
  components: (manifest) => manifest.spec.contributes.components.length > 0 || manifest.spec.category === "component",
  harness: (manifest) => manifest.spec.category === "harness",
  skills: (manifest) => manifest.spec.contributes.skills.length > 0,
  tools: (manifest) => manifest.spec.contributes.tools.length + manifest.spec.contributes.mcpServers.length > 0,
  agents: (manifest) => manifest.spec.contributes.agents.length > 0,
  knowledge: (manifest) => manifest.spec.contributes.knowledge.length > 0,
  profiles: (manifest) => manifest.kind === "Profile" || manifest.spec.category === "profile",
  templates: (manifest) => manifest.kind === "Template",
  adapters: (manifest) => manifest.kind === "Adapter" || manifest.spec.category === "adapter",
};

function describe(item: PackageRecord): Manifest | undefined {
  try {
    return normalizeManifest(item.manifest);
  } catch {
    return undefined;
  }
}

function byStatus(all: PackageRecord[], status: string): PackageRecord[] {
  if (status !== "latest") return status === "all" ? all : all.filter((item) => item.status === status);
  const latest = new Map<string, PackageRecord>();
  for (const item of all) {
    const current = latest.get(item.name);
    if (item.status === "active" && (!current || item.publishedAt > current.publishedAt)) latest.set(item.name, item);
  }
  return [...latest.values()];
}

function matches(item: PackageRecord, options: CatalogOptions, q: string | undefined): boolean {
  const manifest = describe(item);
  if (!manifest)
    return (
      !options.type && !options.category && (!q || `${item.name} ${item.description}`.toLocaleLowerCase().includes(q))
    );
  const { spec, kind, metadata } = manifest;
  if (options.category && spec.category !== options.category) return false;
  if (options.type && !CATALOG_TYPES[options.type]?.(manifest)) return false;
  if (!q) return true;
  return [
    item.name,
    item.description,
    spec.category,
    kind,
    ...spec.provides.map((capability) => capability.capability),
    ...(metadata.keywords ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase()
    .includes(q);
}

export async function catalog(packages: PackagesService, options: CatalogOptions) {
  const all = (await packages.list(undefined, undefined, true)).filter(
    (item) => !options.visible || options.visible(item.name),
  );
  const versions = new Map<string, number>();
  for (const item of all) versions.set(item.name, (versions.get(item.name) ?? 0) + 1);
  const list = byStatus(all, options.status ?? "latest");
  const categories = [...new Set(list.map((item) => describe(item)?.spec.category ?? item.type))].sort();
  const q = options.q?.trim().toLocaleLowerCase();
  const filtered = list
    .filter((item) => matches(item, options, q))
    .sort((a, b) => a.name.localeCompare(b.name) || b.publishedAt.localeCompare(a.publishedAt));
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100),
    offset = Math.max(options.offset ?? 0, 0);
  return {
    items: filtered.slice(offset, offset + limit).map((item) => ({ ...item, versions: versions.get(item.name) ?? 1 })),
    total: filtered.length,
    categories,
  };
}

export async function summary(packages: PackagesService, visible: PackageReader) {
  const rows = (await packages.summaryRows()).filter((row) => visible(row.name));
  const recent = rows.filter((row) => row.status !== "yanked").slice(0, 6);
  return {
    versions: rows.length,
    packages: new Set(rows.filter((row) => row.status === "active").map((row) => row.name)).size,
    agents: (await catalog(packages, { type: "agents", limit: 1, visible })).total,
    recent: recent.map(({ type, status, ...item }) => ({ ...item, category: type })),
  };
}
