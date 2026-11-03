import { AppError, invariant } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import semver from "semver";
import { featureDependencies } from "../packages/package-features.js";
import type { Candidate, ResolveInput, ResolveSource } from "./resolution-types.js";

const PACKAGE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

class FeatureMismatch {
  constructor(readonly cause: unknown) {}
}

export interface Requirement {
  name: string;
  range: string;
  chain: string[];
}
export type Selected<T> = Map<string, Candidate<T>>;

export class DependencySearch<T> {
  private attempts = 0;
  private readonly cache = new Map<string, Promise<Array<Candidate<T>>>>();
  readonly featureSkips = new Map<string, { version: string; error: unknown }>();

  constructor(
    private readonly source: ResolveSource<T>,
    private readonly input: ResolveInput,
    readonly featuresOf: (name: string, manifest: PackageManifestV1) => string[],
  ) {}

  private versions(name: string): Promise<Array<Candidate<T>>> {
    if (!this.cache.has(name)) this.cache.set(name, this.source.versions(name));
    return this.cache.get(name)!;
  }

  private assertBudget(pending: Requirement[], selected: Selected<T>): void {
    invariant(
      ++this.attempts <= 5000 && pending.length <= 1000 && selected.size <= 200,
      422,
      "RESOLUTION_LIMIT",
      "La resolución excede el presupuesto; reduce dependencias o fija versiones",
    );
  }

  private assertRequirement(requirement: Requirement): void {
    invariant(
      requirement.chain.length <= 64,
      422,
      "RESOLUTION_LIMIT",
      "La cadena de dependencias es demasiado profunda",
    );
    invariant(
      PACKAGE_NAME.test(requirement.name),
      400,
      "INVALID_PACKAGE_NAME",
      `Nombre de paquete inválido: ${requirement.name}`,
    );
    if (requirement.chain.includes(requirement.name))
      throw new AppError(
        409,
        "DEPENDENCY_CYCLE",
        `Ciclo de dependencias: ${[...requirement.chain, requirement.name].join(" -> ")}`,
      );
  }

  private rangesFor(requirement: Requirement, constraints: Map<string, string[]>): string[] {
    const overridden = this.input.overrides?.[requirement.name];
    if (overridden)
      invariant(
        Boolean(semver.validRange(overridden)),
        400,
        "INVALID_OVERRIDE",
        `Override inválido: ${requirement.name}@${overridden}`,
      );
    return [...(constraints.get(requirement.name) ?? []), overridden ?? (requirement.range || "*")];
  }

  private async candidatesFor(requirement: Requirement, ranges: string[]): Promise<Array<Candidate<T>>> {
    const locked = this.input.locked?.[requirement.name];
    const candidates = (await this.versions(requirement.name))
      .filter(
        (item) =>
          item.status !== "yanked" &&
          semver.valid(item.version) &&
          ranges.every((range) => semver.satisfies(item.version, range)),
      )
      .sort(
        (a, b) =>
          (b.version === locked ? 1 : 0) - (a.version === locked ? 1 : 0) || semver.rcompare(a.version, b.version),
      );
    if (!candidates.length)
      throw new AppError(
        404,
        "DEPENDENCY_NOT_FOUND",
        `No hay versión de ${requirement.name} compatible con ${ranges.join(", ")}`,
        { chain: requirement.chain },
      );
    return candidates;
  }

  private candidateFeatures(requirement: Requirement, candidate: Candidate<T>): string[] {
    if (candidate.manifest.kind === "Template")
      throw new AppError(
        422,
        "TEMPLATE_NOT_INSTALLABLE",
        `${requirement.name} es un template de proyecto: no se instala, se usa con modai template use ${requirement.name}`,
        { chain: requirement.chain },
      );
    try {
      return this.featuresOf(requirement.name, candidate.manifest);
    } catch (error) {
      if (!this.featureSkips.has(requirement.name))
        this.featureSkips.set(requirement.name, { version: candidate.version, error });
      throw new FeatureMismatch(error);
    }
  }

  private async tryCandidates(
    requirement: Requirement,
    rest: Requirement[],
    selected: Selected<T>,
    constraints: Map<string, string[]>,
    candidates: Array<Candidate<T>>,
  ): Promise<Selected<T>> {
    let lastError: unknown;
    let featureError: unknown;
    const chain = [...requirement.chain, requirement.name];
    for (const candidate of candidates) {
      let features: string[];
      try {
        features = this.candidateFeatures(requirement, candidate);
      } catch (error) {
        if (!(error instanceof FeatureMismatch)) throw error;
        featureError ??= error.cause;
        continue;
      }
      const nextSelected = new Map(selected).set(requirement.name, candidate);
      const dependencies = Object.entries(featureDependencies(candidate.manifest, features)).map(([name, range]) => ({
        name,
        range,
        chain,
      }));
      try {
        return await this.solve([...dependencies, ...rest], nextSelected, constraints);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? featureError;
  }

  async solve(pending: Requirement[], selected: Selected<T>, constraints: Map<string, string[]>): Promise<Selected<T>> {
    this.assertBudget(pending, selected);
    if (!pending.length) return selected;
    const [requirement, ...rest] = pending;
    this.assertRequirement(requirement);
    const ranges = this.rangesFor(requirement, constraints);
    const nextConstraints = new Map(constraints).set(requirement.name, ranges);
    const current = selected.get(requirement.name);
    if (current) {
      if (!ranges.every((range) => semver.satisfies(current.version, range)))
        throw new AppError(409, "DEPENDENCY_CONFLICT", `Conflicto para ${requirement.name}: ${ranges.join(", ")}`, {
          chain: requirement.chain,
        });
      return this.solve(rest, selected, nextConstraints);
    }
    const candidates = await this.candidatesFor(requirement, ranges);
    return this.tryCandidates(requirement, rest, selected, nextConstraints, candidates);
  }
}
