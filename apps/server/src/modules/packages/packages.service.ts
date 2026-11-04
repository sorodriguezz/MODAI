import { AppError, invariant } from "@modai/contracts/errors";
import { publicKeyFingerprint, sha256 } from "@modai/contracts/security";
import type {
  ArtifactFile,
  PackageRecord,
  PublishPackageInput,
  ResolvedPackage,
  ResolveRequest,
} from "@modai/contracts/types";
import { type Candidate, normalizeManifest, resolve as resolveGraph } from "@modai/core";
import semver from "semver";
import type { DataContext } from "../../infrastructure/database/database.js";
import { type PublishSettings, publishPackage } from "./package-publisher.js";
import { PACKAGE_NAME, type PackageRow, rowToPackage } from "./package-record.js";
import { PackagesRepository } from "./packages.repository.js";
import { PublishersRepository } from "./publishers.repository.js";

export class PackagesService {
  private readonly packages: PackagesRepository;
  private readonly publishers: PublishersRepository;

  constructor(
    private readonly context: DataContext,
    private readonly settings: PublishSettings,
  ) {
    this.packages = new PackagesRepository(context);
    this.publishers = new PublishersRepository(context);
  }

  withContext(context: DataContext): PackagesService {
    return new PackagesService(context, this.settings);
  }

  private async decorate(row: PackageRow): Promise<PackageRecord> {
    return (await this.decorateAll([row]))[0];
  }

  private async decorateAll(rows: PackageRow[]): Promise<PackageRecord[]> {
    const publishers = rows.some((row) => row.signer_fingerprint && row.signature)
      ? new Map((await this.publishers.exportAll()).map((item) => [item.fingerprint, item]))
      : new Map();
    return rows.map((row) => this.withSignature(row, publishers.get(row.signer_fingerprint ?? "")));
  }

  private withSignature(row: PackageRow, publisher?: { publicKey: string; trusted: number }): PackageRecord {
    const record = rowToPackage(row);
    if (!row.signature) return record;
    if (publisher) {
      record.signature = { algorithm: "ed25519", publicKey: publisher.publicKey, signature: row.signature };
      record.publisherTrusted = Boolean(publisher.trusted);
    }
    return record;
  }

  async list(query?: string, type?: string, includeYanked = false): Promise<PackageRecord[]> {
    return this.decorateAll(await this.packages.list(query, type, includeYanked));
  }

  summaryRows() {
    return this.packages.summaryRows();
  }

  async get(name: string, version?: string): Promise<PackageRecord> {
    let row: PackageRow | undefined;
    if (version) row = await this.packages.byNameVersion(name, version);
    else
      row = (await this.packages.byName(name)).sort(
        (a, b) =>
          Number(a.status === "yanked") - Number(b.status === "yanked") || semver.rcompare(a.version, b.version),
      )[0];
    if (!row) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}${version ? `@${version}` : ""}`);
    return this.decorate(row);
  }

  async publish(input: PublishPackageInput): Promise<PackageRecord> {
    const identity = await publishPackage(this.context, this.settings, input);
    return this.get(identity.name, identity.version);
  }

  async resolve(request: ResolveRequest): Promise<ResolvedPackage[]> {
    invariant(
      Array.isArray(request.packages) && request.packages.length > 0,
      400,
      "INVALID_RESOLVE_REQUEST",
      "packages es obligatorio",
    );
    const source = {
      versions: async (name: string): Promise<Array<Candidate<PackageRow>>> => {
        if (!PACKAGE_NAME.test(name)) return [];
        return (await this.packages.byName(name)).map((row) => ({
          version: row.version,
          status: row.status as PackageRecord["status"],
          manifest: normalizeManifest(JSON.parse(row.manifest_json)),
          ref: row,
        }));
      },
    };
    const resolution = await resolveGraph(source, { roots: request.packages, overrides: request.overrides });
    return this.decorateAll(resolution.packages.map((node) => node.ref));
  }

  artifactOwner(id: string): Promise<string | undefined> {
    return this.packages.artifactOwner(id);
  }

  async getArtifact(id: string): Promise<{ files: ArtifactFile[]; sha256: string }> {
    const hash = await this.packages.artifactHash(id);
    if (!hash) throw new AppError(404, "ARTIFACT_NOT_FOUND", `Artefacto no encontrado: ${id}`);
    const body = this.settings.artifacts.read(id);
    invariant(
      sha256(body) === hash,
      500,
      "ARTIFACT_CORRUPT",
      `El artefacto ${id} no supera la verificación de integridad`,
    );
    return { ...(JSON.parse(body) as { files: ArtifactFile[] }), sha256: hash };
  }

  async deprecate(name: string, version: string, message: string): Promise<PackageRecord> {
    const changed = await this.packages.setStatus(
      name,
      version,
      "deprecated",
      message.trim() || "Versión deprecada",
      true,
    );
    if (!changed) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe una versión activa ${name}@${version}`);
    return this.get(name, version);
  }

  async yank(name: string, version: string, reason: string): Promise<PackageRecord> {
    const changed = await this.packages.setStatus(name, version, "yanked", reason.trim() || "Versión retirada", false);
    if (!changed) throw new AppError(404, "PACKAGE_NOT_FOUND", `No existe ${name}@${version}`);
    return this.get(name, version);
  }

  async hardDelete(name: string, version: string, confirmation: string): Promise<void> {
    invariant(
      confirmation === `${name}@${version}`,
      400,
      "CONFIRMATION_REQUIRED",
      `confirmation debe ser exactamente ${name}@${version}`,
    );
    const record = await this.get(name, version);
    invariant(record.status === "yanked", 409, "PACKAGE_NOT_YANKED", "Primero retira la versión con yank");
    await this.packages.deleteVersion(name, version, record.artifactId);
    this.settings.artifacts.remove(record.artifactId);
  }

  async registerPublisher(publicKey: string, label: string, trusted: boolean): Promise<string> {
    const fingerprint = publicKeyFingerprint(publicKey);
    await this.publishers.register(fingerprint, publicKey, label, trusted);
    return fingerprint;
  }

  listPublishers(): Promise<unknown[]> {
    return this.publishers.list();
  }

  async trustPublisher(fingerprint: string, trusted: boolean, label?: string): Promise<void> {
    if (!(await this.publishers.trust(fingerprint, trusted, label)))
      throw new AppError(404, "PUBLISHER_NOT_FOUND", `Publicador no encontrado: ${fingerprint}`);
  }
}
