export const PACKAGE_TYPES = [
  "methodology",
  "harness",
  "knowledge",
  "skill",
  "memory",
  "tool",
  "adapter",
  "template",
  "mcp",
  "profile",
] as const;

export type PackageType = (typeof PACKAGE_TYPES)[number];

export interface PackageFileRule {
  source: string;
  target: string;
  executable?: boolean;
}

export interface KnowledgeRule {
  source: string;
  title: string;
  tags?: string[];
}

export interface PackageManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  type: PackageType;
  description: string;
  dependencies?: Record<string, string>;
  files?: PackageFileRule[];
  knowledge?: KnowledgeRule[];
  configuration?: Record<string, unknown>;
}

export type PackageStatus = "active" | "deprecated" | "yanked";

export interface PackageSignature {
  algorithm: "ed25519";
  publicKey: string;
  signature: string;
}

export interface QualityFinding {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface QualityReport {
  score: number;
  findings: QualityFinding[];
  dimensions: Record<string, number>;
}

export interface ArtifactFile {
  path: string;
  content: string;
  sha256: string;
}

export interface PublishPackageInput {
  manifest: PackageManifest;
  files: ArtifactFile[];
  signature?: PackageSignature;
}

export interface PackageRecord {
  name: string;
  version: string;
  type: PackageType;
  description: string;
  artifactId: string;
  manifest: PackageManifest;
  publishedAt: string;
  status: PackageStatus;
  deprecatedMessage?: string;
  signerFingerprint?: string;
  quality?: QualityReport;
}

export interface ResolvedPackage extends PackageRecord {}

export interface ResolveRequest {
  packages: Array<{ name: string; range?: string }>;
  overrides?: Record<string, string>;
}

export interface MemoryInput {
  projectId: string;
  scope?: string;
  kind?: string;
  content: string;
  metadata?: Record<string, unknown>;
}
