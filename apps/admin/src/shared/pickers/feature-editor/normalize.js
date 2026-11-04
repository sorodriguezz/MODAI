const EDITED = [
  "description",
  "default",
  "requires",
  "conflicts",
  "dependencies",
  "overlays",
  "path",
  "packages",
  "vars",
  "uses",
];

const versionOf = (spec) => (typeof spec === "string" ? spec : spec.version);

function templatePackages(feature) {
  return Object.fromEntries(Object.entries(feature.packages || {}).map(([name, spec]) => [name, versionOf(spec)]));
}

function templatePackageFeatures(feature) {
  return Object.fromEntries(
    Object.entries(feature.packages || {})
      .filter(([, spec]) => typeof spec === "object" && spec.features?.length)
      .map(([name, spec]) => [name, spec.features]),
  );
}

function extraOf(feature, mode) {
  const extra = Object.fromEntries(Object.entries(feature).filter(([key]) => key !== "name" && !EDITED.includes(key)));
  if (mode === "package" && feature.overlays?.length > 1) extra.overlays = feature.overlays.slice(1);
  return extra;
}

function modeFields(feature, mode) {
  if (mode === "template")
    return {
      folder: feature.path || "",
      packageFeatures: templatePackageFeatures(feature),
      initialPackages: templatePackages(feature),
    };
  return {
    folder: feature.overlays?.[0]?.path || "",
    packageFeatures: {},
    initialPackages: { ...(feature.dependencies || {}) },
  };
}

function normalizeOne(feature, mode) {
  const fields = modeFields(feature, mode);
  return {
    name: feature.name,
    description: feature.description || "",
    default: Boolean(feature.default),
    requires: [...(feature.requires || [])],
    conflicts: [...(feature.conflicts || [])],
    folder: fields.folder,
    component: feature.overlays?.[0]?.component || "",
    packageFeatures: fields.packageFeatures,
    initialPackages: fields.initialPackages,
    vars: Object.entries(feature.vars || {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    uses: feature.uses || "",
    extra: extraOf(feature, mode),
  };
}

export function normalize(initial, mode) {
  const list = Array.isArray(initial)
    ? initial
    : Object.entries(initial || {}).map(([name, feature]) => ({ name, ...feature }));
  return list.map((feature) => normalizeOne(feature, mode));
}
