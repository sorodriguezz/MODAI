const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const ADDON = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(@[^\s@]+)?$/;

function doesSomething(feature, mode) {
  return (
    feature.folder ||
    feature.uses ||
    feature.vars.trim() ||
    feature.requires.length ||
    feature.picker.size ||
    (mode === "package" && Object.keys(feature.extra.contributes || {}).length)
  );
}

function badVars(feature) {
  return feature.vars.split("\n").some((line) => line.trim() && !/^[A-Za-z][\w-]*\s*=/.test(line.trim()));
}

function folderEmpty(feature, paths) {
  return feature.folder && paths && !paths.some((path) => path.startsWith(`${feature.folder}/`));
}

function shapeIssue(feature, label, names) {
  if (!NAME.test(feature.name))
    return `${label}: el nombre usa minúsculas, números y guiones, empezando por letra (máx. 40).`;
  if (names.filter((name) => name === feature.name).length > 1) return `Hay dos opciones llamadas --${feature.name}.`;
  if (!feature.description.trim()) return `${label}: describe qué hace (es lo que se ve en --help).`;
  if (feature.requires.some((name) => feature.conflicts.includes(name)))
    return `${label}: no puede activar y ser incompatible con la misma opción.`;
  if (badVars(feature)) return `${label}: cada marcador va como clave=valor, uno por línea.`;
  if (feature.uses && !ADDON.test(feature.uses)) return `${label}: el add-on es @namespace/nombre[@versión].`;
  return "";
}

function featureIssue(feature, { names, paths, mode }) {
  const label = feature.name ? `--${feature.name}` : "Una opción nueva";
  const shape = shapeIssue(feature, label, names);
  if (shape) return shape;
  if (folderEmpty(feature, paths))
    return `${label}: la carpeta ${feature.folder} no tiene archivos. Créala en el paso Archivos o deja el campo vacío.`;
  if (!doesSomething(feature, mode))
    return `${label} no hace nada: indica una carpeta, paquetes, otras opciones que activa${mode === "template" ? ", marcadores o un add-on" : ""}.`;
  const problem = feature.picker.issue();
  return problem ? `${label}: ${problem}` : "";
}

export function featuresIssue(features, mode, paths) {
  const names = features.map((feature) => feature.name);
  for (const feature of features) {
    const issue = featureIssue(feature, { names, paths, mode });
    if (issue) return issue;
  }
  return "";
}
