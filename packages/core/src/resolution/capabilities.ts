import { AppError } from "@modai/contracts/errors";
import semver from "semver";
import { CapabilityError, type Resolution, type ResolvedNode } from "./resolution-types.js";

type Provider = { provider: string; version: string };
type Providers = Map<string, Provider[]>;

function collectProviders<T>(packages: Array<ResolvedNode<T>>): Providers {
  const providers: Providers = new Map();
  for (const item of packages)
    for (const capability of item.manifest.spec.provides)
      providers.set(capability.capability, [
        ...(providers.get(capability.capability) ?? []),
        { provider: item.name, version: capability.version },
      ]);
  return providers;
}

function assertPinsInstalled(providers: Providers, pins: Record<string, string>, names: Set<string>): void {
  for (const [capability, provider] of Object.entries(pins)) {
    if (providers.get(capability)?.some((item) => item.provider === provider)) continue;
    throw new CapabilityError(
      409,
      "PROVIDER_NOT_INSTALLED",
      `modai.yaml fija ${provider} como proveedor de ${capability}, pero ${names.has(provider) ? "no la proporciona" : "no está instalado"}`,
      { capability, provider },
    );
  }
}

function chooseProviders<T>(resolution: Resolution<T>, providers: Providers, pins: Record<string, string>): void {
  for (const [capability, list] of providers) {
    const sorted = [...list].sort((a, b) => a.provider.localeCompare(b.provider));
    const chosen = sorted.find((item) => item.provider === pins[capability]) ?? sorted[0];
    resolution.capabilities[capability] = chosen;
    if (sorted.length > 1 && !pins[capability])
      resolution.warnings.push(
        `Varios paquetes proporcionan ${capability} (${sorted.map((item) => item.provider).join(", ")}); se usa ${chosen.provider}. Fíjalo con modai capability use ${capability} <paquete>.`,
      );
  }
}

function matchProvider(providers: Providers, pins: Record<string, string>, capability: string, range: string) {
  const candidates = (providers.get(capability) ?? [])
    .filter((provider) => semver.satisfies(provider.version, range))
    .sort((a, b) => a.provider.localeCompare(b.provider));
  return candidates.find((provider) => provider.provider === pins[capability]) ?? candidates[0];
}

function unsatisfiedError(
  item: { name: string },
  requirement: { capability: string; version: string },
  providers: Providers,
) {
  const available = providers.get(requirement.capability);
  const detail = available?.length
    ? `; los proveedores instalados ofrecen ${available.map((p) => `${p.provider} (${p.version})`).join(", ")}`
    : " y ningún paquete instalado la proporciona";
  return new CapabilityError(
    409,
    "CAPABILITY_UNSATISFIED",
    `${item.name} requiere la capacidad ${requirement.capability}@${requirement.version}${detail}`,
    { package: item.name, capability: requirement.capability, range: requirement.version },
  );
}

function matchRequirements<T>(
  resolution: Resolution<T>,
  item: ResolvedNode<T>,
  providers: Providers,
  pins: Record<string, string>,
): void {
  const chosenFor: Record<string, string> = {};
  for (const requirement of item.manifest.spec.requires) {
    const provider = matchProvider(providers, pins, requirement.capability, requirement.version);
    if (!provider) throw unsatisfiedError(item, requirement, providers);
    chosenFor[requirement.capability] = provider.provider;
  }
  for (const requirement of item.manifest.spec.optional) {
    const provider = matchProvider(providers, pins, requirement.capability, requirement.version);
    if (provider) chosenFor[requirement.capability] = provider.provider;
    else
      resolution.missingOptional.push({
        package: item.name,
        capability: requirement.capability,
        range: requirement.version,
      });
  }
  if (Object.keys(chosenFor).length) resolution.requires[item.name] = chosenFor;
}

function assertNoConflicts<T>(item: ResolvedNode<T>, providers: Providers, names: Set<string>): void {
  for (const conflict of item.manifest.spec.conflicts) {
    if ("package" in conflict && names.has(conflict.package))
      throw new AppError(409, "PACKAGE_CONFLICT", `${item.name} es incompatible con ${conflict.package}`);
    if (!("capability" in conflict)) continue;
    const other = providers.get(conflict.capability)?.find((provider) => provider.provider !== item.name);
    if (other)
      throw new AppError(
        409,
        "CAPABILITY_CONFLICT",
        `${item.name} es incompatible con la capacidad ${conflict.capability} de ${other.provider}`,
      );
  }
}

export function resolveCapabilities<T>(resolution: Resolution<T>, pins: Record<string, string>): void {
  const providers = collectProviders(resolution.packages);
  const names = new Set(resolution.packages.map((item) => item.name));
  assertPinsInstalled(providers, pins, names);
  chooseProviders(resolution, providers, pins);
  for (const item of resolution.packages) {
    matchRequirements(resolution, item, providers, pins);
    assertNoConflicts(item, providers, names);
  }
}
