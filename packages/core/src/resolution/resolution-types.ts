import { AppError } from "@modai/contracts/errors";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import type { PackageStatus } from "@modai/contracts/types";

export interface Candidate<T> {
  version: string;
  status: PackageStatus;
  manifest: PackageManifestV1;
  ref: T;
}
export interface ResolveSource<T> {
  versions(name: string): Promise<Array<Candidate<T>>>;
}

export interface ResolveInput {
  roots: Array<{ name: string; range?: string }>;
  overrides?: Record<string, string>;
  locked?: Record<string, string>;
  features?: Record<string, Record<string, boolean>>;
  providers?: Record<string, string>;
  platform?: string;
  coreVersion?: string;
  checkCapabilities?: boolean;
}

export interface ResolvedNode<T> {
  name: string;
  version: string;
  manifest: PackageManifestV1;
  ref: T;
  dependencies: Record<string, string>;
  features: string[];
}

export interface Resolution<T> {
  packages: Array<ResolvedNode<T>>;
  capabilities: Record<string, { provider: string; version: string }>;
  requires: Record<string, Record<string, string>>;
  missingOptional: Array<{ package: string; capability: string; range: string }>;
  warnings: string[];
}

export class CapabilityError extends AppError {}
