import type { PublishPackageInput, RunRecord } from "@modai/contracts/types";

export interface Snapshot {
  schemaVersion: 1;
  exportedAt: string;
  packages: Array<PublishPackageInput & { status?: string; deprecatedMessage?: string }>;
  knowledge: Array<{ title: string; content: string; tags: string[]; packageName?: string }>;
  memories: Array<{
    projectId: string;
    scope: string;
    kind: string;
    content: string;
    metadata: Record<string, unknown>;
    sessionId?: string;
  }>;
  organizations?: Array<{ id: string; name: string; description?: string; createdAt: string }>;
  namespaces?: Array<{
    name: string;
    organizationId?: string;
    description?: string;
    visibility?: "internal" | "restricted";
    createdAt: string;
  }>;
  projects?: Array<{ id: string; name: string; organizationId?: string; createdAt: string }>;
  runs?: RunRecord[];
  installations?: Array<{
    projectId: string;
    packageName: string;
    version: string;
    direct: boolean;
    reportedAt: string;
  }>;
  publishers: Array<{ fingerprint: string; label?: string; publicKey: string; trusted: boolean }>;
}

export interface ImportResult {
  packages: number;
  skipped: number;
  knowledge: number;
  memories: number;
  installations: number;
}
