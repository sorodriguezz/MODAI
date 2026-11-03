import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AppError } from "@modai/contracts/errors";
import { packageNameSchema } from "@modai/contracts/schemas";
import type {
  ArtifactFile,
  PackageManifest,
  PackageSignature,
  PackageStatus,
  PublishPackageInput,
} from "@modai/contracts/types";
import semver from "semver";
import { computeIntegrity, verifySignature } from "../packages/integrity.js";
import { manifestIdentity } from "../packages/normalize.js";
import { validatePackage } from "../packages/validate.js";
import { latestPerName, type PackageArtifact, type PackageVersion, type Registry } from "./registry.js";

interface StoredArtifact {
  manifest: PackageManifest;
  files: ArtifactFile[];
  signature?: PackageSignature;
  integrity: string;
  status: PackageStatus;
  publishedAt: string;
}

export class LocalRegistry implements Registry {
  readonly id: string;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    this.id = `file:${this.root}`;
  }

  private directory(name: string): string {
    if (!packageNameSchema.safeParse(name).success)
      throw new AppError(400, "INVALID_PACKAGE_NAME", `Nombre de paquete inválido: ${name}`);
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
    return readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
      .filter((version) => semver.valid(version))
      .map((version) => {
        const stored = this.read(name, version);
        return { name, version, status: stored.status, manifest: stored.manifest, registry: this.id };
      });
  }

  async fetch(name: string, version: string): Promise<PackageArtifact> {
    const stored = this.read(name, version);
    return {
      name,
      version,
      manifest: stored.manifest,
      files: stored.files,
      signature: stored.signature,
      integrity: stored.integrity,
      source: this.id,
    };
  }

  async list(query?: string): Promise<PackageVersion[]> {
    if (!existsSync(this.root)) return [];
    const all: PackageVersion[] = [];
    for (const scope of readdirSync(this.root).filter((entry) => entry.startsWith("@"))) {
      for (const short of readdirSync(join(this.root, scope))) {
        all.push(...(await this.versions(`${scope}/${short}`).catch(() => [])));
      }
    }
    return latestPerName(all, query);
  }

  async publish(input: PublishPackageInput): Promise<{ name: string; version: string; integrity: string }> {
    const manifest = validatePackage(input.manifest, input.files);
    if (input.signature)
      verifySignature(manifest.metadata.name, input.manifest, input.files, input.signature, {
        policy: "signed",
        trustedPublishers: [],
      });
    const { name, version } = manifestIdentity(input.manifest);
    const directory = this.directory(name);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `${version}.json`);
    if (existsSync(path)) throw new AppError(409, "PACKAGE_EXISTS", `${name}@${version} ya existe y es inmutable`);
    const integrity = computeIntegrity(input.manifest, input.files);
    const stored: StoredArtifact = {
      manifest: input.manifest,
      files: input.files,
      signature: input.signature,
      integrity,
      status: "active",
      publishedAt: new Date().toISOString(),
    };
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify(stored), { flag: "wx" });
    renameSync(temporary, path);
    return { name, version, integrity };
  }
}
