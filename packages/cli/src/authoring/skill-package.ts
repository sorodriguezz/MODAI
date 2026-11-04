import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import type { PublishPackageInput } from "@modai/contracts/types";
import { type ArchiveEntry, skillArchiveToPackage, writeZip } from "@modai/core";
import type { ApiClient } from "@modai/sdk";

const IGNORED = /(^|\/)(node_modules|\.git|\.DS_Store|Thumbs\.db)(\/|$)/;

function folderEntries(root: string, relative = ""): ArchiveEntry[] {
  const absolute = relative ? join(root, relative) : root;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || (relative && IGNORED.test(relative))) return [];
  if (info.isFile()) return [{ path: relative, bytes: readFileSync(absolute) }];
  return info.isDirectory()
    ? readdirSync(absolute)
        .sort()
        .flatMap((name) => folderEntries(root, relative ? posix.join(relative, name) : name))
    : [];
}

export async function resolveNamespace(api: ApiClient, namespace?: string): Promise<string> {
  if (namespace) return namespace;
  const { publish } = (await api.session()).permissions;
  if (!publish.all && publish.namespaces.length === 1) return publish.namespaces[0]!;
  throw new Error(
    `Indica --namespace. ${publish.all ? "Puedes publicar en cualquiera." : publish.namespaces.length ? `Puedes publicar en: ${publish.namespaces.join(", ")}.` : "Esta credencial no puede publicar en ningún namespace."}`,
  );
}

export function skillSourceToPackage(
  source: string,
  options: { namespace: string; version?: string; name?: string },
): PublishPackageInput & { skill: { name: string; description: string } } {
  const path = resolve(source);
  if (statSync(path).isFile()) return skillArchiveToPackage(readFileSync(path), options);
  if (!existsSync(join(path, "SKILL.md"))) throw new Error(`${path} no contiene SKILL.md`);
  const folder = basename(path);
  return skillArchiveToPackage(
    writeZip(folderEntries(path).map((entry) => ({ path: `${folder}/${entry.path}`, bytes: entry.bytes }))),
    options,
  );
}
