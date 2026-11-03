import type { MemoryInput } from "@modai/contracts/types";
import { KnowledgeApi } from "./knowledge.js";

export class MemoryApi extends KnowledgeApi {
  async remember(input: MemoryInput): Promise<unknown> {
    const response = await this.request<{ memory: unknown }>("/api/v1/memories", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.memory;
  }

  async recall(
    projectId: string,
    query: string,
    options: { includeOrganization?: boolean; sessionId?: string } = {},
  ): Promise<unknown[]> {
    const response = await this.request<{ results: unknown[] }>("/api/v1/memories/search", {
      method: "POST",
      body: JSON.stringify({ projectId, query, ...options }),
    });
    return response.results;
  }

  async listMemories(projectId: string): Promise<unknown[]> {
    const response = await this.request<{ memories: unknown[] }>(
      `/api/v1/memories?projectId=${encodeURIComponent(projectId)}`,
    );
    return response.memories;
  }

  async updateMemory(id: string, input: Record<string, unknown>): Promise<unknown> {
    const response = await this.request<{ memory: unknown }>(`/api/v1/memories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return response.memory;
  }

  async deleteMemory(id: string): Promise<void> {
    await this.request(`/api/v1/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
