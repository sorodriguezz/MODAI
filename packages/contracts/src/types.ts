import type { PackageManifestV1Input } from "./spec-v1.js";
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
  "agent",
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
  permissions?: Permission[];
  capabilities?: CapabilityDefinition[];
  agent?: AgentDefinition;
}

/** Legacy (schemaVersion: 1) or v1 (apiVersion: modai.dev/v1) manifest, exactly as published. */
export type AnyPackageManifest = PackageManifest | PackageManifestV1Input;
export function isV1Manifest(manifest: unknown): manifest is PackageManifestV1Input {
  return typeof manifest === "object" && manifest !== null && (manifest as { apiVersion?: unknown }).apiVersion === "modai.dev/v1";
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
  manifest: AnyPackageManifest;
  files: ArtifactFile[];
  signature?: PackageSignature;
}

export interface PackageRecord {
  name: string;
  version: string;
  /** Legacy type or v1 category; informative only. */
  type: string;
  description: string;
  artifactId: string;
  manifest: AnyPackageManifest;
  publishedAt: string;
  status: PackageStatus;
  deprecatedMessage?: string;
  signerFingerprint?: string;
  signature?: PackageSignature;
  publisherTrusted?: boolean;
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
  sessionId?: string;
}

export type Permission = "project.instructions" | "project.files" | "process.execute" | "mcp.connect";
export type SignaturePolicy = "optional" | "signed" | "trusted";
export type CapabilityDefinition =
  | { kind: "tool"; name: string; description: string; inputSchema: Record<string, unknown>; binding: string }
  | { kind: "mcp"; name: string; description: string; command: string; args: string[]; envKeys: string[] };
export interface AgentDefinition {
  instructions: string;
  skills: string[];
  capabilities: string[];
  memory: { read: Array<"project" | "organization" | "session">; write: boolean };
  runtime?: { provider: "ollama"; model?: string };
}
export interface ProjectRecord { id: string; name: string; organizationId?: string; createdAt: string }
export interface AgentBundle {
  schemaVersion: 1;
  projectId: string;
  agent: { name: string; version: string; definition: AgentDefinition };
  packages: PackageRecord[];
  capabilities: CapabilityDefinition[];
  instructions: Array<{ packageName: string; path: string; content: string }>;
  permissions: Permission[];
  digest: string;
}
export interface RunRecord {
  id: string; projectId: string; agentName: string; agentVersion: string; task: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  bundle: AgentBundle; result?: string; error?: string; attempts: number;
  createdAt: string; updatedAt: string; leaseExpiresAt?: string;
}
export interface ClaimedRun { run: RunRecord; leaseToken: string }
export interface RunnerBinding { command: string; args: string[]; envKeys?: string[]; timeoutMs?: number }
export interface Activation {
  schemaVersion: 1; server: string; bundle: AgentBundle;
  adapter: "files" | "agents-md" | "claude-md";
  allowedTools: string[]; allowedMcp: string[]; allowedEnv?: string[];
}
