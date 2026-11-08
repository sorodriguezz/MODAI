import type { KnowledgeDocument } from "../types.js";
import { TemplatesApi } from "./templates.js";

export class KnowledgeApi extends TemplatesApi {
  async searchKnowledge(
    query: string,
    packageNames?: string[],
    packageVersions?: Array<{ name: string; version: string }>,
  ): Promise<unknown[]> {
    const response = await this.request<{ results: unknown[] }>("/api/v1/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ query, packageNames, packageVersions }),
    });
    return response.results;
  }

  async knowledgeDocuments(offset = 0): Promise<{ documents: KnowledgeDocument[]; nextOffset: number | null }> {
    return this.request(`/api/v1/knowledge/documents?limit=100&offset=${offset}`);
  }

  async saveVector(id: string, model: string, embedding: number[], sourceHash?: string): Promise<void> {
    await this.request(`/api/v1/knowledge/documents/${encodeURIComponent(id)}/vector`, {
      method: "PUT",
      body: JSON.stringify({ model, embedding, sourceHash }),
    });
  }

  async vectorSearch(model: string, embedding: number[], packageNames?: string[]): Promise<unknown[]> {
    const data = await this.request<{ results: unknown[] }>("/api/v1/knowledge/vector-search", {
      method: "POST",
      body: JSON.stringify({ model, embedding, packageNames }),
    });
    return data.results;
  }

  async createKnowledge(input: { title: string; content: string; tags?: string[] }): Promise<KnowledgeDocument> {
    return (
      await this.request<{ document: KnowledgeDocument }>("/api/v1/knowledge/documents", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).document;
  }

  async updateKnowledge(
    id: string,
    input: { title?: string; content?: string; tags?: string[] },
  ): Promise<KnowledgeDocument> {
    return (
      await this.request<{ document: KnowledgeDocument }>(`/api/v1/knowledge/documents/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).document;
  }

  async deleteKnowledge(id: string): Promise<void> {
    await this.request(`/api/v1/knowledge/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}
