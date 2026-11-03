import { get } from "./lib/api.js";

// Shared panel state. The session cookie is HttpOnly: no credential is stored in the browser.
export const state = {
  user: null,
  identity: null,
  /** What this identity may do, computed by the server (GET /auth/status → permissions). */
  permissions: null,
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
  /** Counters and recent publications for the dashboard. */
  summary: cached("summary", async () => get("/packages/summary")),
  /** Latest version of each agent package. The server filters; pages of 100 until complete. */
  agents: cached("agents", async () => {
    const items = [];
    for (let offset = 0; ; offset += 100) {
      const page = await get("/packages/catalog?type=agents&status=latest&limit=100&offset=" + offset);
      items.push(...page.items);
      if (!page.items.length || items.length >= page.total) return items;
    }
  }),
  projects: cached("projects", async () => (await get("/projects")).projects),
  organizations: cached("organizations", async () => (await get("/organizations")).organizations),
  namespaces: cached("namespaces", async () => (await get("/namespaces")).namespaces),
  documents: cached("documents", async () => (await get("/knowledge/documents?limit=500")).documents),
  invalidate(...keys) {
    if (!keys.length) cache.clear();
    keys.forEach((key) => cache.delete(key));
  },
};

// ---------------------------------------------------------------- permissions (from the server)

export const role = () => state.identity?.role;
const perm = () => state.permissions || { manage: {}, publish: { all: false, namespaces: [] }, organizations: [], assignableRoles: [] };
export const can = {
  /** Global administration (audit, backups, publishers, every organization). */
  admin: () => Boolean(perm().global),
  /** Global or organization administration: users, API keys, organizations and namespaces. */
  manage: () => Boolean(perm().manage.users),
  manageUsers: () => Boolean(perm().manage.users),
  manageKeys: () => Boolean(perm().manage.apiKeys),
  manageOrganizations: () => Boolean(perm().manage.organizations),
  createOrganizations: () => Boolean(perm().manage.createOrganizations),
  /** Deprecate or yank: global admins, or the admin of the package's namespace organization. */
  managePackages: (name) => Boolean(perm().manage.packages) || (name ? (perm().packages?.namespaces || []).includes(String(name).split("/")[0]) : (perm().packages?.namespaces || []).length > 0),
  /** Permanent deletion stays with global administration. */
  deletePackages: () => Boolean(perm().manage.packages),
  publish: () => perm().publish.all || perm().publish.namespaces.length > 0,
  publishTo: (namespace) => perm().publish.all || perm().publish.namespaces.includes(namespace),
  /** Manual knowledge documents follow the publisher role, not namespaces. */
  writeKnowledge: () => Boolean(perm().createProjects),
  writeMemory: () => Boolean(perm().writeMemory),
  submitRuns: () => Boolean(perm().submitRuns),
  createProject: () => Boolean(perm().createProjects),
  assignableRoles: () => perm().assignableRoles,
  /** Organizations the identity administers ("all" for global admins). */
  managedOrganizations: () => perm().organizations.filter((o) => o.manage),
};

// ---------------------------------------------------------------- manifests

/**
 * Normalises a v1 manifest ({apiVersion:'modai.dev/v1',kind,metadata,spec}) into one shape for display.
 * Unknown fields are ignored; nothing here is trusted markup.
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
  const spec = manifest.spec || {};
  const contributes = spec.contributes || {};
  return {
    apiVersion: manifest.apiVersion ?? "desconocido",
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
