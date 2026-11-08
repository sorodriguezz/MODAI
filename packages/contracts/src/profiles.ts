export type BindingTarget = { scope: "organization" | "team" | "project"; id: string };

export interface CapabilityBindingInput {
  slot?: string;
  packageName: string;
  range: string;
  required?: boolean;
  exception?: { reason: string; reviewAt: string };
}

export interface CapabilityBinding extends CapabilityBindingInput {
  target: BindingTarget;
  slot: string;
  required: boolean;
  approvedBy: string;
  updatedAt: string;
}

export interface EffectiveProfile {
  schemaVersion: 1;
  projectId: string;
  organizationId?: string;
  bindings: CapabilityBinding[];
  packages: Array<{ name: string; version: string; artifactId: string }>;
  capabilities: Record<string, { provider: string; version: string }>;
  digest: string;
}

export interface TeamRecord {
  id: string;
  organizationId: string;
  name: string;
  createdAt: string;
}

export interface ExecutionPolicy {
  allowedModels?: string[];
  allowedCapabilities?: string[];
}

export interface WorkerCapabilities {
  model?: string;
  mcp?: string[];
}
