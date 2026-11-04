import { AppError, invariant } from "@modai/contracts/errors";
import { normalizeManifest } from "@modai/core";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { PackageReader } from "../auth/authorization.service.js";
import { CategoriesRepository } from "./categories.repository.js";

export interface CategoryRecord {
  name: string;
  description: string;
  registered: boolean;
  packages: number;
  createdAt?: string;
  updatedAt?: string;
}

const CATEGORY = /^[a-z][a-z0-9-]{0,63}$/;

const cleanDescription = (value: unknown) =>
  String(value ?? "")
    .trim()
    .slice(0, 500);

function categoryOf(manifestJson: string): string | undefined {
  try {
    return normalizeManifest(JSON.parse(manifestJson)).spec.category;
  } catch {
    return undefined;
  }
}

export class CategoriesService {
  private readonly categories: CategoriesRepository;

  constructor(context: DataContext) {
    this.categories = new CategoriesRepository(context);
  }

  private async usage(visible: PackageReader): Promise<Map<string, Set<string>>> {
    const usage = new Map<string, Set<string>>();
    for (const row of await this.categories.activeManifests()) {
      if (!visible(row.name)) continue;
      const category = categoryOf(row.manifest_json);
      if (category) usage.set(category, (usage.get(category) ?? new Set()).add(row.name));
    }
    return usage;
  }

  async list(visible: PackageReader): Promise<CategoryRecord[]> {
    const usage = await this.usage(visible);
    const registered = (await this.categories.list()).map((row) => ({
      name: row.name,
      description: row.description,
      registered: true,
      packages: usage.get(row.name)?.size ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    const known = new Set(registered.map((item) => item.name));
    const unregistered = [...usage.entries()]
      .filter(([name]) => !known.has(name))
      .map(([name, names]) => ({ name, description: "", registered: false, packages: names.size }));
    return [...registered, ...unregistered].sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(input: { name: string; description?: string }): Promise<CategoryRecord> {
    const name = String(input.name ?? "").trim();
    invariant(
      CATEGORY.test(name),
      400,
      "INVALID_CATEGORY",
      "La categoría usa minúsculas, números y guiones, empezando por letra (máx. 64)",
    );
    invariant(!(await this.categories.exists(name)), 409, "CATEGORY_EXISTS", `La categoría ${name} ya existe`);
    const now = new Date().toISOString();
    await this.categories.insert({
      name,
      description: cleanDescription(input.description),
      created_at: now,
      updated_at: now,
    });
    return this.get(name);
  }

  async update(name: string, input: { description?: string }): Promise<CategoryRecord> {
    if (!(await this.categories.update(name, cleanDescription(input.description))))
      throw new AppError(404, "CATEGORY_NOT_FOUND", `No existe la categoría ${name}`);
    return this.get(name);
  }

  async remove(name: string): Promise<void> {
    if (!(await this.categories.delete(name)))
      throw new AppError(404, "CATEGORY_NOT_FOUND", `No existe la categoría ${name}`);
  }

  private async get(name: string): Promise<CategoryRecord> {
    const found = (await this.list(() => true)).find((item) => item.name === name && item.registered);
    if (!found) throw new AppError(404, "CATEGORY_NOT_FOUND", `No existe la categoría ${name}`);
    return found;
  }
}
