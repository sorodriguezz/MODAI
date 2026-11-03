import type { PackageManifestV1 } from "@modai/contracts/manifest";

export type PackageFeatureSpec = PackageManifestV1["spec"]["features"][string];

export function contributionDirectories(contributes: {
  components: Array<{ path: string }>;
  skills: Array<{ path: string }>;
}): string[] {
  return [...contributes.components, ...contributes.skills].map((item) =>
    item.path === "." ? "" : item.path.replace(/\/$/, ""),
  );
}

export const isInside = (path: string, directory: string) =>
  directory === "" || path === directory || path.startsWith(`${directory}/`);

export const featureOwnDirectories = (feature: PackageFeatureSpec) => [
  ...contributionDirectories(feature.contributes),
  ...feature.overlays.map((overlay) => overlay.path.replace(/\/$/, "")),
];

export const featureOwnPaths = (feature: PackageFeatureSpec) => [
  ...featureOwnDirectories(feature),
  ...feature.contributes.rules.map((rule) => rule.path),
  ...feature.contributes.knowledge.map((item) => item.path),
  ...feature.contributes.files.map((rule) => rule.source),
];
