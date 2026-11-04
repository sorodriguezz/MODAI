import { get } from "../shared/lib/api.js";

export const state = {
  user: null,
  identity: null,
  permissions: null,
  health: null,
  minPasswordLength: 10,
};

const cache = new Map();

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
  summary: cached("summary", async () => get("/packages/summary")),
  agents: cached("agents", async () => {
    const items = [];
    for (let offset = 0; ; offset += 100) {
      const page = await get(`/packages/catalog?type=agents&status=latest&limit=100&offset=${offset}`);
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
    for (const key of keys) cache.delete(key);
  },
};

export const role = () => state.identity?.role;
const perm = () =>
  state.permissions || { manage: {}, publish: { all: false, namespaces: [] }, organizations: [], assignableRoles: [] };
const packageNamespaces = () => perm().packages?.namespaces || [];
export const can = {
  admin: () => Boolean(perm().global),
  manage: () => Boolean(perm().manage.users),
  manageUsers: () => Boolean(perm().manage.users),
  manageKeys: () => Boolean(perm().manage.apiKeys),
  manageOrganizations: () => Boolean(perm().manage.organizations),
  createOrganizations: () => Boolean(perm().manage.createOrganizations),
  managePackages: (name) =>
    Boolean(perm().manage.packages) ||
    (name ? packageNamespaces().includes(String(name).split("/")[0]) : packageNamespaces().length > 0),
  deletePackages: () => Boolean(perm().manage.packages),
  publish: () => perm().publish.all || perm().publish.namespaces.length > 0,
  publishTo: (namespace) => perm().publish.all || perm().publish.namespaces.includes(namespace),
  writeKnowledge: (packageName) =>
    packageName ? can.publishTo(String(packageName).split("/")[0]) : Boolean(perm().writeKnowledge),
  createKnowledge: () => Boolean(perm().publish?.all || perm().publish?.namespaces?.length),
  writeMemory: () => Boolean(perm().writeMemory),
  submitRuns: () => Boolean(perm().submitRuns),
  createProject: () => Boolean(perm().createProjects),
  assignableRoles: () => perm().assignableRoles,
  managedOrganizations: () => perm().organizations.filter((o) => o.manage),
};
