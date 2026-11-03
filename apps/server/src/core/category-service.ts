import { AppError, invariant } from "@modai/contracts/errors";
import { normalizeManifest } from "@modai/core";
import type { Database } from "./database.js";

/**
 * Catalog categories. A category stays informative (the Core never changes behaviour on it and a manifest may
 * declare any valid one), but the panel offers the registered ones so the catalog does not fill with typos.
 * Categories that packages use without being registered are listed too, so an admin can register them.
 */
export interface CategoryRecord {
  name: string;
  description: string;
  registered: boolean;
  packages: number;
  createdAt?: string;
  updatedAt?: string;
}

const CATEGORY = /^[a-z][a-z0-9-]{0,63}$/;

/** Registered on a fresh server: the kinds of things the panel can create plus common areas. */
const DEFAULTS: Array<[string, string]> = [
  ["component", "Código que se copia al proyecto: módulos de backend, componentes de UI, servicios."],
  ["harness", "Instrucciones, estado, verificación y handoff para que el agente trabaje de forma fiable."],
  ["skill", "Instrucciones que el agente carga bajo demanda."],
  ["knowledge", "Documentos que el agente consulta con búsqueda."],
  ["profile", "Perfiles que componen otros paquetes."],
  ["template", "Proyectos completos para empezar con modai template use."],
  ["adapter", "Conectan MODAI con un cliente (Cursor, OpenCode…)."],
  ["agent", "Agentes listos para activar o enviar tareas."],
  ["mcp", "Herramientas y servidores MCP."],
  ["backend", "Servicios, APIs y persistencia."],
  ["frontend", "Interfaces y arquitectura de cliente."],
  ["testing", "Pruebas, regresión y calidad."],
  ["architecture", "Decisiones y patrones de arquitectura."],
  ["general", "Lo que no encaja en otra categoría."],
];

export class CategoryService {
  constructor(private readonly db: Database) {
    const fresh = !db.connection
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'categories'")
      .get();
    db.connection.exec(`CREATE TABLE IF NOT EXISTS categories (
      name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    if (fresh) {
      const now = new Date().toISOString();
      const insert = db.connection.prepare(
        "INSERT OR IGNORE INTO categories (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)",
      );
      for (const [name, description] of DEFAULTS) insert.run(name, description, now, now);
    }
  }

  /** Registered categories plus the ones in use, with how many packages (latest version of each) use them. */
  list(visible: (name: string) => boolean): CategoryRecord[] {
    const usage = new Map<string, Set<string>>();
    const rows = this.db.connection
      .prepare("SELECT name, manifest_json FROM packages WHERE status <> 'yanked'")
      .all() as Array<{ name: string; manifest_json: string }>;
    for (const row of rows) {
      if (!visible(row.name)) continue;
      let category: string;
      try {
        category = normalizeManifest(JSON.parse(row.manifest_json)).spec.category;
      } catch {
        continue;
      }
      usage.set(category, (usage.get(category) ?? new Set()).add(row.name));
    }
    const registered = (
      this.db.connection.prepare("SELECT name, description, created_at, updated_at FROM categories").all() as Array<{
        name: string;
        description: string;
        created_at: string;
        updated_at: string;
      }>
    ).map((row) => ({
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

  create(input: { name: string; description?: string }): CategoryRecord {
    const name = String(input.name ?? "").trim();
    invariant(
      CATEGORY.test(name),
      400,
      "INVALID_CATEGORY",
      "La categoría usa minúsculas, números y guiones, empezando por letra (máx. 64)",
    );
    invariant(
      !this.db.connection.prepare("SELECT 1 FROM categories WHERE name = ?").get(name),
      409,
      "CATEGORY_EXISTS",
      `La categoría ${name} ya existe`,
    );
    const now = new Date().toISOString();
    this.db.connection
      .prepare("INSERT INTO categories (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(
        name,
        String(input.description ?? "")
          .trim()
          .slice(0, 500),
        now,
        now,
      );
    return this.get(name);
  }

  update(name: string, input: { description?: string }): CategoryRecord {
    const changed = this.db.connection
      .prepare("UPDATE categories SET description = ?, updated_at = ? WHERE name = ?")
      .run(
        String(input.description ?? "")
          .trim()
          .slice(0, 500),
        new Date().toISOString(),
        name,
      );
    if (!changed.changes) throw new AppError(404, "CATEGORY_NOT_FOUND", `No existe la categoría ${name}`);
    return this.get(name);
  }

  /** Unregisters a category. Published versions are immutable: packages that use it keep it, now as unregistered. */
  remove(name: string): void {
    const changed = this.db.connection.prepare("DELETE FROM categories WHERE name = ?").run(name);
    if (!changed.changes) throw new AppError(404, "CATEGORY_NOT_FOUND", `No existe la categoría ${name}`);
  }

  private get(name: string): CategoryRecord {
    const found = this.list(() => true).find((item) => item.name === name && item.registered);
    if (!found) throw new AppError(404, "CATEGORY_NOT_FOUND", `No existe la categoría ${name}`);
    return found;
  }
}
