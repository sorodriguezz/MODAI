import type { EffectiveProfile, PackageRecord } from "@modai/contracts/types";
import { CompositeRegistry, HttpRegistry, type Registry } from "@modai/core";
import type { ApiClient } from "@modai/sdk";

export class ProfileRegistry implements Registry {
  readonly id: string;
  private readonly central: HttpRegistry;
  private readonly fallback: CompositeRegistry;
  private readonly pins: Map<string, EffectiveProfile["packages"][number]>;
  private readonly records = new Map<string, Promise<PackageRecord>>();

  constructor(
    server: string,
    private readonly api: ApiClient,
    profile: EffectiveProfile,
    registries: Registry[],
  ) {
    this.central = new HttpRegistry(server, undefined, api);
    this.fallback = new CompositeRegistry(registries);
    this.id = this.central.id;
    this.pins = new Map(profile.packages.map((item) => [item.name, item]));
  }

  private record(pin: EffectiveProfile["packages"][number]): Promise<PackageRecord> {
    const existing = this.records.get(pin.name);
    if (existing) return existing;
    const record = this.api.getPackage(pin.name, pin.version).then((item) => {
      if (
        item.name !== pin.name ||
        item.version !== pin.version ||
        item.artifactId !== pin.artifactId ||
        item.status === "yanked"
      )
        throw new Error(`PROFILE_CHANGED: cambió el artefacto de ${pin.name}@${pin.version}. Vuelve a sincronizar.`);
      return item;
    });
    this.records.set(pin.name, record);
    return record;
  }

  async versions(name: string) {
    const pin = this.pins.get(name);
    if (!pin) return this.fallback.versions(name);
    const { version, status, manifest } = await this.record(pin);
    return [{ name, version, status, manifest, registry: this.id }];
  }

  async fetch(name: string, version: string) {
    const pin = this.pins.get(name);
    if (!pin) return this.fallback.fetch(name, version);
    if (pin.version !== version) throw new Error(`El perfil requiere ${name}@${pin.version}`);
    return this.central.fetchRecord(await this.record(pin));
  }

  list(query?: string) {
    return this.fallback.list(query);
  }
}
