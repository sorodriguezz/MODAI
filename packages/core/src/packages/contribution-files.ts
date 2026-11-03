import { expandTemplate } from "../installation/targets.js";

export function skillFiles(
  skill: { path: string; files?: string[] },
  paths: Iterable<string>,
): Array<{ source: string; relative: string }> {
  const base = skill.path === "." ? "" : `${skill.path.replace(/\/$/, "")}/`;
  if (skill.files) return skill.files.map((relative) => ({ source: `${base}${relative}`, relative }));
  return [...paths]
    .filter((path) => path.startsWith(base))
    .map((source) => ({ source, relative: source.slice(base.length) }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

export function componentFiles(
  component: { name: string; path: string; target: string },
  packageName: string,
  paths: Iterable<string>,
): Array<{ source: string; target: string }> {
  const base = component.path === "." ? "" : `${component.path.replace(/\/$/, "")}/`;
  const directory = expandTemplate(component.target, { component: component.name, package: packageName }).replace(
    /\/$/,
    "",
  );
  return [...paths]
    .filter((path) => path.startsWith(base) && path !== "modai.package.yaml")
    .map((source) => ({ source, target: `${directory}/${source.slice(base.length)}` }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

export function packageFileReferences(args: string[]): string[] {
  return args.flatMap((arg) => [...arg.matchAll(/\$\{packageDir\}\/([^\s"']+)/g)].map((match) => match[1]));
}
