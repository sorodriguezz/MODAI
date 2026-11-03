import type { PackageManifestV1Input, PermissionV1 } from "./spec-v1.js";
import type { BuiltinToolName } from "./agent-tools.js";
/** A package manifest exactly as published (apiVersion: modai.dev/v1). */
export type PackageManifest = PackageManifestV1Input;

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
  /** Package category (spec.category); informative only. */
  type: string;
  description: string;
  artifactId: string;
  manifest: PackageManifest;
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

export type SignaturePolicy = "optional" | "signed" | "trusted";
/** What an activated agent may call, resolved from its definition and the packages it depends on. */
export type AgentCapability =
  | { kind: "builtin"; name: BuiltinToolName; description: string; inputSchema: Record<string, unknown> }
  | { kind: "mcp"; name: string; package: string; description: string; command: string; args: string[]; envKeys: string[] };
export interface AgentDefinition {
  instructions: string;
  skills: string[];
  capabilities: string[];
  memory: { read: Array<"project" | "organization" | "session">; write: boolean };
  runtime?: { provider: "ollama"; model?: string };
}
export interface ProjectRecord { id: string; name: string; organizationId?: string; createdAt: string; /** Whether the caller may delete it (admin or creator). */ canDelete?: boolean }
export interface AgentBundle {
  schemaVersion: 1;
  projectId: string;
  agent: { name: string; version: string; definition: AgentDefinition };
  packages: PackageRecord[];
  capabilities: AgentCapability[];
  instructions: Array<{ packageName: string; path: string; content: string }>;
  permissions: PermissionV1[];
  digest: string;
}
export interface RunRecord {
  id: string; projectId: string; agentName: string; agentVersion: string; task: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  bundle: AgentBundle; result?: string; error?: string; attempts: number;
  createdAt: string; updatedAt: string; leaseExpiresAt?: string;
}
export interface ClaimedRun { run: RunRecord; leaseToken: string }
export interface Activation {
  schemaVersion: 1; server: string; bundle: AgentBundle;
  adapter: "files" | "agents-md" | "claude-md";
  allowedMcp: string[]; allowedEnv?: string[];
}
