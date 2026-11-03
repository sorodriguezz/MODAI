import type { ProjectRecord } from "@modai/contracts/types";
import { MemoryApi } from "./memory.js";

export class ProjectsApi extends MemoryApi {
  async createProject(input: { id?: string; name: string; organizationId?: string }): Promise<ProjectRecord> {
    return (
      await this.request<{ project: ProjectRecord }>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).project;
  }

  async deleteProject(id: string): Promise<{ deleted: ProjectRecord; memories: number; runs: number }> {
    return this.request(`/api/v1/projects/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation: id }),
    });
  }

  async projects(): Promise<ProjectRecord[]> {
    return (await this.request<{ projects: ProjectRecord[] }>("/api/v1/projects")).projects;
  }

  async updateProject(id: string, input: { name?: string; organizationId?: string | null }): Promise<ProjectRecord> {
    return (
      await this.request<{ project: ProjectRecord }>(`/api/v1/projects/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
    ).project;
  }

  async reportInstallations(
    projectId: string,
    packages: Array<{ name: string; version: string; direct?: boolean }>,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(`/api/v1/projects/${encodeURIComponent(projectId)}/installations`, {
      method: "PUT",
      body: JSON.stringify({ packages }),
      signal,
    });
  }
}
