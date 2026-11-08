import type {
  AgentBundle,
  ClaimedRun,
  ExecutionPolicy,
  PackageRecord,
  RunRecord,
  WorkerCapabilities,
} from "@modai/contracts/types";
import { AdminApi } from "./admin.js";

export class RunsApi extends AdminApi {
  async executionPolicy(projectId: string): Promise<ExecutionPolicy | null> {
    const path = `/api/v1/projects/${encodeURIComponent(projectId)}/execution-policy`;
    return (await this.request<{ policy: ExecutionPolicy | null }>(path)).policy;
  }

  async setExecutionPolicy(projectId: string, policy: ExecutionPolicy): Promise<ExecutionPolicy> {
    const path = `/api/v1/projects/${encodeURIComponent(projectId)}/execution-policy`;
    return (
      await this.request<{ policy: ExecutionPolicy }>(path, {
        method: "PUT",
        body: JSON.stringify(policy),
      })
    ).policy;
  }

  async deleteExecutionPolicy(projectId: string): Promise<void> {
    await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/execution-policy`, { method: "DELETE" });
  }

  async agents(): Promise<PackageRecord[]> {
    return (await this.request<{ agents: PackageRecord[] }>("/api/v1/agents")).agents;
  }

  async capabilities(capability?: string): Promise<{ builtin: unknown[]; contracts: unknown[] }> {
    return this.request<{ builtin: unknown[]; contracts: unknown[] }>(
      `/api/v1/capabilities${capability ? `?capability=${encodeURIComponent(capability)}` : ""}`,
    );
  }

  async composeAgent(
    projectId: string,
    name: string,
    range = "*",
    overrides?: Record<string, string>,
  ): Promise<AgentBundle> {
    return (
      await this.request<{ bundle: AgentBundle }>("/api/v1/agents/compose", {
        method: "POST",
        body: JSON.stringify({ projectId, name, range, overrides }),
      })
    ).bundle;
  }

  async submitRun(input: {
    projectId: string;
    name: string;
    range?: string;
    task: string;
    overrides?: Record<string, string>;
    idempotencyKey?: string;
  }): Promise<RunRecord> {
    return (await this.request<{ run: RunRecord }>("/api/v1/runs", { method: "POST", body: JSON.stringify(input) }))
      .run;
  }

  async runs(projectId: string): Promise<RunRecord[]> {
    return (await this.request<{ runs: RunRecord[] }>(`/api/v1/runs?projectId=${encodeURIComponent(projectId)}`)).runs;
  }

  async run(id: string): Promise<RunRecord> {
    return (await this.request<{ run: RunRecord }>(`/api/v1/runs/${encodeURIComponent(id)}`)).run;
  }

  async cancelRun(id: string): Promise<RunRecord> {
    return (
      await this.request<{ run: RunRecord }>(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        body: "{}",
      })
    ).run;
  }

  async claimRun(projectId: string, capabilities?: WorkerCapabilities): Promise<ClaimedRun | null> {
    return (
      await this.request<{ claimed: ClaimedRun | null }>("/api/v1/worker/claim", {
        method: "POST",
        body: JSON.stringify({ projectId, ...capabilities }),
      })
    ).claimed;
  }

  async heartbeat(id: string, leaseToken: string): Promise<string> {
    return (
      await this.request<{ leaseExpiresAt: string }>(`/api/v1/worker/runs/${encodeURIComponent(id)}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ leaseToken }),
      })
    ).leaseExpiresAt;
  }

  async finishRun(id: string, leaseToken: string, outcome: { result: string } | { error: string }): Promise<RunRecord> {
    return (
      await this.request<{ run: RunRecord }>(`/api/v1/worker/runs/${encodeURIComponent(id)}/finish`, {
        method: "POST",
        body: JSON.stringify({ leaseToken, ...outcome }),
      })
    ).run;
  }
}
