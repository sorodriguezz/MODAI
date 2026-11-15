import type { KnowledgeDocument, KnowledgeSearchResult, KnowledgeVectorResult } from "../types.js";
import { TemplatesApi } from "./templates.js";

function documentsPath(projectId?: string): string {
  const prefix = projectId === undefined ? "/api/v1" : `/api/v1/projects/${encodeURIComponent(projectId)}`;
  return `${prefix}/knowledge/documents`;
}

function documentPath(id: string, projectId?: string): string {
  return `${documentsPath(projectId)}/${encodeURIComponent(id)}`;
}

export class KnowledgeApi extends TemplatesApi {
  async searchKnowledge(
    query: string,
    packageNames?: string[],
    packageVersions?: Array<{ name: string; version: string }>,
  ): Promise<KnowledgeSearchResult[]> {
    const response = await this.request<{ results: KnowledgeSearchResult[] }>("/api/v1/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ query, packageNames, packageVersions }),
    });
    return response.results;
  }

  async knowledgeDocuments(
    offset = 0,
    projectId?: string,
  ): Promise<{ documents: KnowledgeDocument[]; nextOffset: number | null }> {
    return this.request(`${documentsPath(projectId)}?limit=100&offset=${offset}`);
  }

  async knowledgeDocument(id: string, projectId?: string): Promise<KnowledgeDocument> {
    return (await this.request<{ document: KnowledgeDocument }>(documentPath(id, projectId))).document;
  }

  async saveVector(
    id: string,
    model: string,
    embedding: number[],
    sourceHash?: string,
    projectId?: string,
  ): Promise<void> {
    await this.request(`${documentPath(id, projectId)}/vector`, {
      method: "PUT",
      body: JSON.stringify({ model, embedding, sourceHash }),
    });
  }

  async vectorSearch(model: string, embedding: number[], packageNames?: string[]): Promise<KnowledgeVectorResult[]> {
    const data = await this.request<{ results: KnowledgeVectorResult[] }>("/api/v1/knowledge/vector-search", {
      method: "POST",
      body: JSON.stringify({ model, embedding, packageNames }),
    });
    return data.results;
  }

  async createKnowledge(
    input: { title: string; content: string; tags?: string[]; packageName?: string },
    projectId?: string,
  ): Promise<KnowledgeDocument> {
    return (
      await this.request<{ document: KnowledgeDocument }>(documentsPath(projectId), {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).document;
  }

  async updateKnowledge(
    id: string,
    input: { title?: string; content?: string; tags?: string[] },
    projectId?: string,
  ): Promise<KnowledgeDocument> {
    return (
      await this.request<{ document: KnowledgeDocument }>(documentPath(id, projectId), {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).document;
  }

  async deleteKnowledge(id: string, projectId?: string): Promise<void> {
    await this.request(documentPath(id, projectId), { method: "DELETE" });
  }
}
