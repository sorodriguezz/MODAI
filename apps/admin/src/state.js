import { get } from "./lib/api.js";

// Shared panel state. The session cookie is HttpOnly: no credential is stored in the browser.
export const state = {
  user: null,
  identity: null,
  health: null,
  minPasswordLength: 10,
};

const cache = new Map();

/** Cached loader; `force` refetches. Concurrent callers share the same request. */
function cached(key, loader) {
  return (force = false) => {
    if (force || !cache.has(key)) {
      const promise = loader().catch((error) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, promise);
    }
    return cache.get(key);
  };
}

export const store = {
  packages: cached("packages", async () => (await get("/packages?includeYanked=true")).packages),
  projects: cached("projects", async () => (await get("/projects")).projects),
  documents: cached("documents", async () => (await get("/knowledge/documents?limit=500")).documents),
  invalidate(...keys) {
    if (!keys.length) cache.clear();
    keys.forEach((key) => cache.delete(key));
  },
};

// ---------------------------------------------------------------- permissions (mirror auth-service)

export const role = () => state.identity?.role;
export const can = {
  admin: () => role() === "admin",
  publish: () => ["publisher", "admin"].includes(role()),
  writeMemory: () => ["publisher", "worker", "admin"].includes(role()),
  submitRuns: () => ["publisher", "admin"].includes(role()),
  createProject: () => ["publisher", "admin"].includes(role()),
};

// ---------------------------------------------------------------- manifests

/**
 * Normalises legacy ({schemaVersion:1,name,type,…}) and v1 ({apiVersion:'modai.dev/v1',kind,metadata,spec})
 * manifests into one shape for display. Unknown fields are ignored; nothing here is trusted markup.
 */
export function describeManifest(record) {
  const manifest = record?.manifest || {};
  const list = (value) => (Array.isArray(value) ? value : []);
  const capability = (item, fallbackVersion) => {
    if (typeof item === "string") {
      const at = item.indexOf("@");
      return { capability: at < 0 ? item : item.slice(0, at), version: at < 0 ? fallbackVersion : item.slice(at + 1) };
    }
    if (item && typeof item === "object") return { capability: String(item.capability ?? item.name ?? "?"), version: String(item.version ?? fallbackVersion), description: item.description };
    return { capability: String(item), version: fallbackVersion };
  };
  if (manifest.apiVersion === "modai.dev/v1") {
    const spec = manifest.spec || {};
    const contributes = spec.contributes || {};
    return {
      format: "v1",
      apiVersion: manifest.apiVersion,
      kind: manifest.kind || "Package",
      name: manifest.metadata?.name ?? record.name,
      version: manifest.metadata?.version ?? record.version,
      description: manifest.metadata?.description ?? record.description,
      license: manifest.metadata?.license,
      authors: list(manifest.metadata?.authors),
      homepage: manifest.metadata?.homepage,
      keywords: list(manifest.metadata?.keywords),
      category: spec.category || record.type || "general",
      dependencies: spec.dependencies || {},
      provides: list(spec.provides).map((item) => capability(item, "1.0.0")),
      requires: list(spec.requires).map((item) => capability(item, "*")),
      optional: list(spec.optional).map((item) => capability(item, "*")),
      permissions: list(spec.permissions),
      contributes: {
        skills: list(contributes.skills),
        rules: list(contributes.rules),
        knowledge: list(contributes.knowledge),
        tools: list(contributes.tools),
        mcpServers: list(contributes.mcpServers),
        agents: list(contributes.agents),
        components: list(contributes.components),
        files: list(contributes.files),
      },
      agents: list(contributes.agents),
      files: list(contributes.files),
    };
  }
  const capabilities = list(manifest.capabilities);
  return {
    format: "legacy",
    apiVersion: "schemaVersion " + (manifest.schemaVersion ?? 1),
    kind: null,
    name: manifest.name ?? record.name,
    version: manifest.version ?? record.version,
    description: manifest.description ?? record.description,
    category: manifest.type || record.type,
    dependencies: manifest.dependencies || {},
    provides: [],
    requires: [],
    optional: [],
    permissions: list(manifest.permissions),
    contributes: {
      skills: [],
      rules: [],
      knowledge: list(manifest.knowledge),
      tools: capabilities.filter((item) => item?.kind === "tool"),
      mcpServers: capabilities.filter((item) => item?.kind === "mcp"),
      agents: manifest.agent ? [{ name: manifest.name, ...manifest.agent }] : [],
      components: [],
      files: list(manifest.files),
    },
    agents: manifest.agent ? [{ name: manifest.name, ...manifest.agent }] : [],
    files: list(manifest.files),
  };
}

/** Latest active version per package name (falls back to latest of any status when all are inactive). */
export function latestByName(packages, includeInactive = false) {
  const map = new Map();
  for (const item of packages) {
    if (!includeInactive && item.status !== "active") continue;
    const current = map.get(item.name);
    if (!current || new Date(item.publishedAt) > new Date(current.publishedAt)) map.set(item.name, item);
  }
  return [...map.values()];
}
