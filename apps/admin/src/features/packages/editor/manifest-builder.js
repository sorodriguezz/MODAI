import { bytesToText } from "../../../shared/lib/files.js";
import { slug, TEMPLATES } from "./package-types.js";

function harnessPermission(target) {
  if (/^(?:\.agents\/(?:skills|harness)\/|\.modai\/(?:packages|adapters|integrations)\/)/.test(target)) return null;
  if (/^(?:AGENTS\.md|CLAUDE\.md|\.agent\/|\.opencode\/agents\/)/.test(target)) return "project.instructions";
  if (/^docs\//.test(target)) return "project.files";
  throw new Error(
    `Un harness solo instala AGENTS.md, CLAUDE.md, .agent/, .opencode/agents/, .agents/harness/ o docs/: ${target}`,
  );
}

const CONTRIBUTIONS = {
  component: (s, _paths, permissions) => {
    permissions.add("project.source");
    return {
      components: [
        {
          name: slug(s.component.name, "component"),
          path: "component",
          target: s.component.target || "src/modules/{component}",
          tags: [],
          ...(s.meta.description ? { description: s.meta.description.slice(0, 1000) } : {}),
          ...(s.component.language ? { language: s.component.language } : {}),
        },
      ],
    };
  },
  harness: (_s, paths, permissions) => ({
    files: paths
      .filter((path) => path.startsWith("harness/"))
      .map((source) => {
        const target = source.slice("harness/".length);
        const permission = harnessPermission(target);
        if (permission) permissions.add(permission);
        return { source, target };
      }),
  }),
  skill: (_s, paths) => {
    const names = [
      ...new Set(paths.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).map((path) => path.split("/")[1])),
    ];
    return { skills: names.map((name) => ({ name, path: `skills/${name}` })) };
  },
  knowledge: (s, paths) => ({
    knowledge: paths
      .filter((path) => /^knowledge\/.+\.(md|txt)$/i.test(path))
      .map((path) => {
        const heading = (bytesToText(s.files.get(path).bytes) || "").match(/^#\s+(.+)$/m)?.[1]?.trim();
        return { path, title: (heading || path.split("/").pop()).slice(0, 300), tags: [] };
      }),
  }),
};

export function buildManifest(s) {
  const paths = [...s.files.keys()].sort();
  const spec = { category: s.meta.category || TEMPLATES[s.template].category };
  const permissions = new Set();
  const contributes = CONTRIBUTIONS[s.template]?.(s, paths, permissions) ?? {};
  if (Object.keys(contributes).length) spec.contributes = contributes;
  if (Object.keys(s.dependencies).length) spec.dependencies = { ...s.dependencies };
  if (Object.keys(s.features).length) spec.features = s.features;
  if (permissions.size) spec.permissions = [...permissions].sort();
  return {
    apiVersion: "modai.dev/v1",
    kind: TEMPLATES[s.template].kind || "Package",
    metadata: {
      name: s.meta.name,
      version: s.meta.version,
      description: s.meta.description,
      ...(s.meta.license ? { license: s.meta.license } : {}),
    },
    spec,
  };
}

function setOrDelete(spec, key, value) {
  if (!value) return;
  if (Object.keys(value).length) spec[key] = key === "dependencies" ? { ...value } : value;
  else delete spec[key];
}

export function withIdentity(manifest, meta, { dependencies, features } = {}) {
  const next = structuredClone(manifest);
  next.metadata ??= {};
  Object.assign(next.metadata, { name: meta.name, version: meta.version, description: meta.description });
  next.spec ??= {};
  if (meta.category) next.spec.category = meta.category;
  setOrDelete(next.spec, "dependencies", dependencies);
  setOrDelete(next.spec, "features", features);
  return next;
}

export function bumpPatch(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "0.1.0";
}
