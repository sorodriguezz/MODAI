const vars = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]),
  );

const when = (condition, value) => (condition ? value : {});

function templatePackages(feature) {
  return Object.fromEntries(
    Object.entries(feature.picker.value).map(([name, range]) => [
      name,
      feature.packageFeatures[name] ? { version: range, features: feature.packageFeatures[name] } : range,
    ]),
  );
}

function templateFeature(feature) {
  return {
    description: feature.description.trim(),
    ...when(feature.folder, { path: feature.folder }),
    ...when(feature.default, { default: true }),
    ...when(feature.requires.length, { requires: feature.requires }),
    ...when(feature.conflicts.length, { conflicts: feature.conflicts }),
    ...when(feature.uses, { uses: feature.uses }),
    ...when(feature.vars.trim(), { vars: vars(feature.vars) }),
    ...(feature.picker.size ? { packages: templatePackages(feature) } : {}),
  };
}

export function templateFeatures(features) {
  return Object.fromEntries(features.map((feature) => [feature.name, templateFeature(feature)]));
}

export function packageFeatures(features, component) {
  return Object.fromEntries(
    features.map((feature) => [
      feature.name,
      {
        ...feature.extra,
        description: feature.description.trim(),
        default: feature.default,
        requires: feature.requires,
        conflicts: feature.conflicts,
        dependencies: feature.picker.value,
        overlays: [
          ...(feature.folder ? [{ component: feature.component || component, path: feature.folder }] : []),
          ...(feature.extra.overlays || []),
        ],
      },
    ]),
  );
}
