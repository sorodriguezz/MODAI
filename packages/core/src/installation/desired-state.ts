import type { PackageManifestV1 } from "@modai/contracts/manifest";

export interface InstallUnit {
  name: string;
  version: string;
  manifest: PackageManifestV1;
  files: Map<string, Buffer>;
}
export interface DesiredFile {
  path: string;
  content: Buffer;
  owner: string;
  adapter?: string;
  executable: boolean;
  permission?: string;
}
export interface DesiredBlock {
  path: string;
  id: string;
  content: string;
  owners: string[];
  adapter: string;
  permission?: string;
}
export interface DesiredJson {
  path: string;
  pointer: string;
  value: unknown;
  adapter: string;
  permission?: string;
}
export interface DesiredState {
  files: DesiredFile[];
  blocks: DesiredBlock[];
  json: DesiredJson[];
}
