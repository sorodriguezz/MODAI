import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import semver from "semver";
import { ApiClient } from "@modai/sdk";
import { AppError } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";
import { packageNameSchema } from "@modai/contracts/schemas";
import type { AnyPackageManifest, ArtifactFile, PackageSignature, PackageStatus, PublishPackageInput } from "@modai/contracts/types";
import { computeIntegrity, verifyFiles, verifySignature } from "./integrity.js";
import { manifestIdentity } from "./normalize.js";
import { validatePackage } from "./validate.js";

export interface PackageVersion {
  name: string;
  version: string;
  status: PackageStatus;
  manifest: AnyPackageManifest;
  registry: string;
}

export interface PackageArtifact {
  name: string;
  version: string;
  manifest: AnyPackageManifest;
  files: ArtifactFile[];
  signature?: PackageSignature;
  integrity: string;
  source: string;
}

/**
 * A registry only stores and serves immutable artifacts. Local folders, the MODAI central
 * server or future backends implement the same contract; the Core never depends on one.
 */
export interface Registry {
  readonly id: string;
  versions(name: string): Promise<PackageVersion[]>;
  fetch(name: string, version: string): Promise<PackageArtifact>;
  /** Latest non-yanked version of every package. Used for discovery and provider suggestions. */
  list(query?: string): Promise<PackageVersion[]>;
  publish?(input: PublishPackageInput): Promise<{ name: string; version: string; integrity: string }>;
}

function latestPerName(versions: PackageVersion[], query?: string): PackageVersion[] {
  const best = new Map<string, PackageVersion>();
  const needle = query?.toLocaleLowerCase();
  for (const item of versions) {
    if (item.status === "yanked") continue;
    if (needle && !`${item.name} ${JSON.stringify(item.manifest)}`.toLocaleLowerCase().includes(needle)) continue;
    const current = best.get(item.name);
    if (!current || semver.gt(item.version, current.version)) best.set(item.name, item);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface StoredArtifact { manifest: AnyPackageManifest; files: ArtifactFile[]; signature?: PackageSignature; integrity: string; status: PackageStatus; publishedAt: string }

/** Registry on disk: <root>/@scope/name/<version>.json. Works offline and can live in a shared folder or a git repo. */
export class LocalRegistry implements Registry {
  readonly id: string;
  private readonly root: string;
  constructor(root: string) { this.root = resolve(root); this.id = `file:${this.root}`; }

  private directory(name: string): string {
    if (!packageNameSchema.safeParse(name).success) throw new AppError(400, "INVALID_PACKAGE_NAME", `Nombre de paquete inválido: ${name}`);
    const [scope, short] = name.split("/");
    return join(this.root, scope, short);
  }

  private read(name: string, version: string): StoredArtifact {
    if (!semver.valid(version)) throw new AppError(400, "INVALID_VERSION", `Versión inválida: ${version}`);
    const path = join(this.directory(name), `${version}.json`);
    if (!existsSync(path)) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}@${version} en ${this.id}`);
    return JSON.parse(readFileSync(path, "utf8")) as StoredArtifact;
  }

  async versions(name: string): Promise<PackageVersion[]> {
    const directory = this.directory(name);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter(file => file.endsWith(".json")).map(file => file.slice(0, -5)).filter(version => semver.valid(version))
      .map(version => { const stored = this.read(name, version); return { name, version, status: stored.status, manifest: stored.manifest, registry: this.id }; });
  }

  async fetch(name: string, version: string): Promise<PackageArtifact> {
    const stored = this.read(name, version);
    return { name, version, manifest: stored.manifest, files: stored.files, signature: stored.signature, integrity: stored.integrity, source: this.id };
  }

  async list(query?: string): Promise<PackageVersion[]> {
    if (!existsSync(this.root)) return [];
    const all: PackageVersion[] = [];
    for (const scope of readdirSync(this.root).filter(entry => entry.startsWith("@"))) {
      for (const short of readdirSync(join(this.root, scope))) {
        try { all.push(...await this.versions(`${scope}/${short}`)); } catch { /* ignore foreign folders */ }
      }
    }
    return latestPerName(all, query);
  }

  async publish(input: PublishPackageInput): Promise<{ name: string; version: string; integrity: string }> {
    const manifest = validatePackage(input.manifest, input.files);
    if (input.signature) verifySignature(manifest.metadata.name, input.manifest, input.files, input.signature, { policy: "signed", trustedPublishers: [] });
    const { name, version } = manifestIdentity(input.manifest);
    const directory = this.directory(name);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${version}.json`);
    if (existsSync(path)) throw new AppError(409, "PACKAGE_EXISTS", `${name}@${version} ya existe y es inmutable`);
    const integrity = computeIntegrity(input.manifest, input.files);
    const stored: StoredArtifact = { manifest: input.manifest, files: input.files, signature: input.signature, integrity, status: "active", publishedAt: new Date().toISOString() };
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify(stored), { flag: "wx" });
    renameSync(temporary, path);
    return { name, version, integrity };
  }
}

/** The MODAI central server used purely as a registry. Compatible with 0.5 servers. */
export class HttpRegistry implements Registry {
  readonly id: string;
  private readonly api: ApiClient;
  /** `api` reuses an authenticated client (for example the one that composed an agent). */
  constructor(readonly url: string, token?: string, api?: ApiClient) { this.id = url.replace(/\/+$/, ""); this.api = api ?? new ApiClient(url, token); }

  private async records(name?: string) {
    return (await this.api.listPackages(name, true)).filter(item => !name || item.name === name);
  }

  async versions(name: string): Promise<PackageVersion[]> {
    return (await this.records(name)).map(item => ({ name: item.name, version: item.version, status: item.status, manifest: item.manifest, registry: this.id }));
  }

  async fetch(name: string, version: string): Promise<PackageArtifact> {
    const record = (await this.records(name)).find(item => item.version === version);
    if (!record) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}@${version} en ${this.id}`);
    const artifact = await this.api.artifact(record.artifactId);
    if (sha256(JSON.stringify({ files: artifact.files })) !== artifact.sha256) throw new AppError(400, "INTEGRITY_MISMATCH", `Integridad del artefacto inválida: ${name}`);
    verifyFiles(name, artifact.files);
    return { name, version, manifest: record.manifest, files: artifact.files, signature: record.signature, integrity: computeIntegrity(record.manifest, artifact.files), source: this.id };
  }

  async list(query?: string): Promise<PackageVersion[]> {
    return latestPerName((await this.records()).map(item => ({ name: item.name, version: item.version, status: item.status, manifest: item.manifest, registry: this.id })), query);
  }

  async publish(input: PublishPackageInput): Promise<{ name: string; version: string; integrity: string }> {
    const record = await this.api.publish(input);
    return { name: record.name, version: record.version, integrity: computeIntegrity(input.manifest, input.files) };
  }
}

/**
 * Ordered list of registries. A package is served entirely by the first registry that knows
 * it; versions are never mixed across registries (prevents dependency confusion).
 */
export class CompositeRegistry implements Registry {
  readonly id: string;
  constructor(readonly registries: Registry[]) { this.id = registries.map(item => item.id).join(","); }

  async owner(name: string): Promise<Registry | undefined> {
    for (const registry of this.registries) {
      try { if ((await registry.versions(name)).length) return registry; }
      catch (error) { if (!(error instanceof AppError && error.statusCode === 404)) throw error; }
    }
    return undefined;
  }
  async versions(name: string): Promise<PackageVersion[]> { return (await (await this.owner(name))?.versions(name)) ?? []; }
  async fetch(name: string, version: string): Promise<PackageArtifact> {
    const registry = await this.owner(name);
    if (!registry) throw new AppError(404, "PACKAGE_NOT_FOUND", `Ningún registry configurado contiene ${name}`);
    return registry.fetch(name, version);
  }
  async list(query?: string): Promise<PackageVersion[]> {
    const seen = new Set<string>(), result: PackageVersion[] = [];
    for (const registry of this.registries) {
      for (const item of await registry.list(query).catch(() => [])) if (!seen.has(item.name)) { seen.add(item.name); result.push(item); }
    }
    return result;
  }
}
