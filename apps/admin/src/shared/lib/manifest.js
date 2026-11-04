const list = (value) => (Array.isArray(value) ? value : []);

function capability(item, fallbackVersion) {
  if (typeof item === "string") {
    const at = item.indexOf("@");
    return { capability: at < 0 ? item : item.slice(0, at), version: at < 0 ? fallbackVersion : item.slice(at + 1) };
  }
  if (item && typeof item === "object")
    return {
      capability: String(item.capability ?? item.name ?? "?"),
      version: String(item.version ?? fallbackVersion),
      description: item.description,
    };
  return { capability: String(item), version: fallbackVersion };
}

function contributions(contributes) {
  return {
    skills: list(contributes.skills),
    rules: list(contributes.rules),
    knowledge: list(contributes.knowledge),
    tools: list(contributes.tools),
    mcpServers: list(contributes.mcpServers),
    agents: list(contributes.agents),
    components: list(contributes.components),
    files: list(contributes.files),
  };
}

function metadataOf(manifest, record) {
  const metadata = manifest.metadata || {};
  return {
    name: metadata.name ?? record.name,
    version: metadata.version ?? record.version,
    description: metadata.description ?? record.description,
    license: metadata.license,
    authors: list(metadata.authors),
    homepage: metadata.homepage,
    keywords: list(metadata.keywords),
  };
}

export function describeManifest(record) {
  const manifest = record?.manifest || {};
  const spec = manifest.spec || {};
  const contributes = spec.contributes || {};
  return {
    apiVersion: manifest.apiVersion ?? "desconocido",
    kind: manifest.kind || "Package",
    ...metadataOf(manifest, record),
    category: spec.category || record.type || "general",
    dependencies: spec.dependencies || {},
    provides: list(spec.provides).map((item) => capability(item, "1.0.0")),
    requires: list(spec.requires).map((item) => capability(item, "*")),
    optional: list(spec.optional).map((item) => capability(item, "*")),
    permissions: list(spec.permissions),
    contributes: contributions(contributes),
    agents: list(contributes.agents),
    files: list(contributes.files),
  };
}
