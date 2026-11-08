import type { MemoryInput } from "@modai/contracts/types";
import { KnowledgeApi } from "./knowledge.js";

export interface MemoryReadOptions {
  includeOrganization?: boolean;
  includePersonal?: boolean;
  includeProject?: boolean;
  sessionId?: string;
  limit?: number;
}

export class MemoryApi extends KnowledgeApi {
  async remember(input: MemoryInput): Promise<unknown> {
    const response = await this.request<{ memory: unknown }>("/api/v1/memories", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return response.memory;
  }

  async recall(projectId: string, query: string, options: MemoryReadOptions = {}): Promise<unknown[]> {
    const response = await this.request<{ results: unknown[] }>("/api/v1/memories/search", {
      method: "POST",
      body: JSON.stringify({ projectId, query, ...options }),
    });
    return response.results;
  }

  async listMemories(projectId: string, options: MemoryReadOptions = {}): Promise<unknown[]> {
    const query = new URLSearchParams({ projectId });
    for (const [key, value] of Object.entries(options)) if (value !== undefined) query.set(key, String(value));
    const response = await this.request<{ memories: unknown[] }>(`/api/v1/memories?${query}`);
    return response.memories;
  }

  async pendingMemories(projectId: string): Promise<unknown[]> {
    const response = await this.request<{ memories: unknown[] }>(
      `/api/v1/memories/pending?projectId=${encodeURIComponent(projectId)}`,
    );
    return response.memories;
  }

  async reviewMemory(id: string, approve: boolean, reviewAt?: string): Promise<unknown> {
    return (
      await this.request<{ review: unknown }>(`/api/v1/memories/${encodeURIComponent(id)}/review`, {
        method: "PUT",
        body: JSON.stringify({ approve, reviewAt }),
      })
    ).review;
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
