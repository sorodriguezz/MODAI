import semver from "semver";
import { AppError, invariant } from "@modai/contracts/errors";
import type { PackageStatus } from "@modai/contracts/types";
import type { PackageManifestV1 } from "@modai/contracts/spec-v1";
import { CORE_VERSION } from "./version.js";

const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

export interface Candidate<T> { version: string; status: PackageStatus; manifest: PackageManifestV1; ref: T }
export interface ResolveSource<T> { versions(name: string): Promise<Array<Candidate<T>>> }

export interface ResolveInput {
  roots: Array<{ name: string; range?: string }>;
  overrides?: Record<string, string>;
  /** Preferred versions (from modai.lock). Used first when they satisfy every constraint. */
  locked?: Record<string, string>;
  /** Explicit provider per capability (modai.yaml `providers`). */
  providers?: Record<string, string>;
  platform?: string;
  coreVersion?: string;
  checkCapabilities?: boolean;
}

export interface ResolvedNode<T> { name: string; version: string; manifest: PackageManifestV1; ref: T; dependencies: Record<string, string> }

export interface Resolution<T> {
  /** Dependencies first, in a deterministic order. */
  packages: Array<ResolvedNode<T>>;
  /** Selected provider for each capability provided in the set. */
  capabilities: Record<string, { provider: string; version: string }>;
  /** Provider chosen for each requirement of each package. */
  requires: Record<string, Record<string, string>>;
  missingOptional: Array<{ package: string; capability: string; range: string }>;
  warnings: string[];
}

export class CapabilityError extends AppError {}

/** Package resolution with backtracking, then capability, conflict and compatibility checks. */
export async function resolve<T>(source: ResolveSource<T>, input: ResolveInput): Promise<Resolution<T>> {
  invariant(Array.isArray(input.roots) && input.roots.length > 0, 400, "INVALID_RESOLVE_REQUEST", "packages es obligatorio");
  type Requirement = { name: string; range: string; chain: string[] };
  type Selected = Map<string, Candidate<T>>;
  const cache = new Map<string, Promise<Array<Candidate<T>>>>();
  const versions = (name: string) => { if (!cache.has(name)) cache.set(name, source.versions(name)); return cache.get(name)!; };
  let attempts = 0;

  const solve = async (pending: Requirement[], selected: Selected, constraints: Map<string, string[]>): Promise<Selected> => {
    invariant(++attempts <= 5000 && pending.length <= 1000 && selected.size <= 200, 422, "RESOLUTION_LIMIT", "La resolución excede el presupuesto; reduce dependencias o fija versiones");
    if (!pending.length) return selected;
    const [requirement, ...rest] = pending;
    invariant(requirement.chain.length <= 64, 422, "RESOLUTION_LIMIT", "La cadena de dependencias es demasiado profunda");
    invariant(PACKAGE_NAME.test(requirement.name), 400, "INVALID_PACKAGE_NAME", `Nombre de paquete inválido: ${requirement.name}`);
    if (requirement.chain.includes(requirement.name)) throw new AppError(409, "DEPENDENCY_CYCLE", `Ciclo de dependencias: ${[...requirement.chain, requirement.name].join(" -> ")}`);

    const nextConstraints = new Map(constraints);
    const overridden = input.overrides?.[requirement.name];
    if (overridden) invariant(Boolean(semver.validRange(overridden)), 400, "INVALID_OVERRIDE", `Override inválido: ${requirement.name}@${overridden}`);
    const ranges = [...(constraints.get(requirement.name) ?? []), overridden ?? (requirement.range || "*")];
    nextConstraints.set(requirement.name, ranges);
    const current = selected.get(requirement.name);
    if (current) {
      if (!ranges.every(range => semver.satisfies(current.version, range))) {
        throw new AppError(409, "DEPENDENCY_CONFLICT", `Conflicto para ${requirement.name}: ${ranges.join(", ")}`, { chain: requirement.chain });
      }
      return solve(rest, selected, nextConstraints);
    }
    const locked = input.locked?.[requirement.name];
    const candidates = (await versions(requirement.name))
      .filter(item => item.status !== "yanked" && semver.valid(item.version) && ranges.every(range => semver.satisfies(item.version, range)))
      .sort((a, b) => (b.version === locked ? 1 : 0) - (a.version === locked ? 1 : 0) || semver.rcompare(a.version, b.version));
    if (!candidates.length) throw new AppError(404, "DEPENDENCY_NOT_FOUND", `No hay versión de ${requirement.name} compatible con ${ranges.join(", ")}`, { chain: requirement.chain });

    let lastError: unknown;
    for (const candidate of candidates) {
      const nextSelected = new Map(selected);
      nextSelected.set(requirement.name, candidate);
      const chain = [...requirement.chain, requirement.name];
      const dependencies = Object.entries(candidate.manifest.spec.dependencies).map(([name, range]) => ({ name, range, chain }));
      try { return await solve([...dependencies, ...rest], nextSelected, nextConstraints); }
      catch (error) { lastError = error; }
    }
    throw lastError;
  };

  const selected = await solve(input.roots.map(item => ({ name: item.name, range: item.range ?? "*", chain: [] })), new Map(), new Map());
  const ordered: Array<ResolvedNode<T>> = [];
  const added = new Set<string>();
  const append = (name: string): void => {
    if (added.has(name)) return;
    const item = selected.get(name)!;
    const dependencies = Object.keys(item.manifest.spec.dependencies);
    for (const dependency of dependencies) append(dependency);
    added.add(name);
    ordered.push({ name, version: item.version, manifest: item.manifest, ref: item.ref, dependencies: Object.fromEntries(dependencies.map(dependency => [dependency, selected.get(dependency)!.version])) });
  };
  for (const item of input.roots) append(item.name);

  const resolution: Resolution<T> = { packages: ordered, capabilities: {}, requires: {}, missingOptional: [], warnings: [] };
  checkCompatibility(ordered, input);
  if (input.checkCapabilities !== false) resolveCapabilities(resolution, input.providers ?? {});
  return resolution;
}

function checkCompatibility<T>(packages: Array<ResolvedNode<T>>, input: ResolveInput): void {
  const platform = input.platform ?? process.platform;
  const core = input.coreVersion ?? CORE_VERSION;
  for (const item of packages) {
    const { os, modai } = item.manifest.spec.compatibility;
    if (os && !os.includes(platform as "linux")) throw new AppError(422, "INCOMPATIBLE_PLATFORM", `${item.name}@${item.version} no admite ${platform} (admite ${os.join(", ")})`);
    if (modai && !semver.satisfies(core, modai, { includePrerelease: true })) throw new AppError(422, "INCOMPATIBLE_CORE", `${item.name}@${item.version} requiere MODAI ${modai}; este Core es ${core}`);
  }
}

/** Matches each `requires` against the `provides` of the resolved set. Packages depend on contracts, not on implementations. */
export function resolveCapabilities<T>(resolution: Resolution<T>, pins: Record<string, string>): void {
  const providers = new Map<string, Array<{ provider: string; version: string }>>();
  for (const item of resolution.packages) {
    for (const capability of item.manifest.spec.provides) {
      providers.set(capability.capability, [...(providers.get(capability.capability) ?? []), { provider: item.name, version: capability.version }]);
    }
  }
  const names = new Set(resolution.packages.map(item => item.name));
  for (const [capability, provider] of Object.entries(pins)) {
    if (!providers.get(capability)?.some(item => item.provider === provider)) {
      throw new CapabilityError(409, "PROVIDER_NOT_INSTALLED", `modai.yaml fija ${provider} como proveedor de ${capability}, pero ${names.has(provider) ? "no la proporciona" : "no está instalado"}`, { capability, provider });
    }
  }
  for (const [capability, list] of providers) {
    const sorted = [...list].sort((a, b) => a.provider.localeCompare(b.provider));
    const chosen = sorted.find(item => item.provider === pins[capability]) ?? sorted[0];
    resolution.capabilities[capability] = chosen;
    if (sorted.length > 1 && !pins[capability]) resolution.warnings.push(`Varios paquetes proporcionan ${capability} (${sorted.map(item => item.provider).join(", ")}); se usa ${chosen.provider}. Fíjalo con modai capability use ${capability} <paquete>.`);
  }
  for (const item of resolution.packages) {
    const chosenFor: Record<string, string> = {};
    const match = (capability: string, range: string) => {
      const candidates = (providers.get(capability) ?? []).filter(provider => semver.satisfies(provider.version, range)).sort((a, b) => a.provider.localeCompare(b.provider));
      return candidates.find(provider => provider.provider === pins[capability]) ?? candidates[0];
    };
    for (const requirement of item.manifest.spec.requires) {
      const provider = match(requirement.capability, requirement.version);
      if (!provider) {
        const available = providers.get(requirement.capability);
        throw new CapabilityError(409, "CAPABILITY_UNSATISFIED",
          `${item.name} requiere la capacidad ${requirement.capability}@${requirement.version}` + (available?.length ? `; los proveedores instalados ofrecen ${available.map(p => `${p.provider} (${p.version})`).join(", ")}` : " y ningún paquete instalado la proporciona"),
          { package: item.name, capability: requirement.capability, range: requirement.version });
      }
      chosenFor[requirement.capability] = provider.provider;
    }
    for (const requirement of item.manifest.spec.optional) {
      const provider = match(requirement.capability, requirement.version);
      if (provider) chosenFor[requirement.capability] = provider.provider;
      else resolution.missingOptional.push({ package: item.name, capability: requirement.capability, range: requirement.version });
    }
    if (Object.keys(chosenFor).length) resolution.requires[item.name] = chosenFor;
    for (const conflict of item.manifest.spec.conflicts) {
      if ("package" in conflict && names.has(conflict.package)) throw new AppError(409, "PACKAGE_CONFLICT", `${item.name} es incompatible con ${conflict.package}`);
      if ("capability" in conflict) {
        const other = providers.get(conflict.capability)?.find(provider => provider.provider !== item.name);
        if (other) throw new AppError(409, "CAPABILITY_CONFLICT", `${item.name} es incompatible con la capacidad ${conflict.capability} de ${other.provider}`);
      }
    }
  }
}
