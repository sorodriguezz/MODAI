import type {
  BindingTarget,
  CapabilityBinding,
  CapabilityBindingInput,
  EffectiveProfile,
  TeamRecord,
} from "@modai/contracts/types";
import { ProjectsApi } from "./projects.js";

const targets = { organization: "organizations", team: "teams", project: "projects" } as const;
const bindingsPath = ({ scope, id }: BindingTarget) => `/api/v1/${targets[scope]}/${encodeURIComponent(id)}/bindings`;
const organizationTeams = (id: string) => `/api/v1/organizations/${encodeURIComponent(id)}/teams`;
const teamPath = (id: string) => `/api/v1/teams/${encodeURIComponent(id)}`;

export class ProfilesApi extends ProjectsApi {
  async effectiveProfile(projectId: string, platform?: string): Promise<EffectiveProfile> {
    const query = platform ? `?platform=${encodeURIComponent(platform)}` : "";
    return (
      await this.request<{ profile: EffectiveProfile }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/effective-profile${query}`,
      )
    ).profile;
  }

  async searchProjectKnowledge(
    projectId: string,
    input: {
      query: string;
      packageNames?: string[];
      limit?: number;
      platform?: string;
    },
  ): Promise<unknown[]> {
    return (
      await this.request<{ results: unknown[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/knowledge/search`, {
        method: "POST",
        body: JSON.stringify(input),
      })
    ).results;
  }

  async bindings(target: BindingTarget): Promise<CapabilityBinding[]> {
    return (await this.request<{ bindings: CapabilityBinding[] }>(bindingsPath(target))).bindings;
  }

  async setBinding(target: BindingTarget, input: CapabilityBindingInput): Promise<CapabilityBinding> {
    return (
      await this.request<{ binding: CapabilityBinding }>(bindingsPath(target), {
        method: "PUT",
        body: JSON.stringify(input),
      })
    ).binding;
  }

  async deleteBinding(target: BindingTarget, slot: string): Promise<void> {
    await this.request(`${bindingsPath(target)}/${encodeURIComponent(slot)}`, { method: "DELETE" });
  }

  async teams(organizationId: string): Promise<TeamRecord[]> {
    return (await this.request<{ teams: TeamRecord[] }>(organizationTeams(organizationId))).teams;
  }

  async createTeam(organizationId: string, name: string): Promise<TeamRecord> {
    return (
      await this.request<{ team: TeamRecord }>(organizationTeams(organizationId), {
        method: "POST",
        body: JSON.stringify({ name }),
      })
    ).team;
  }

  async deleteTeam(id: string): Promise<void> {
    await this.request(teamPath(id), { method: "DELETE" });
  }

  async teamMembers(id: string): Promise<Array<{ id: string; username: string; active: boolean }>> {
    return (
      await this.request<{ members: Array<{ id: string; username: string; active: boolean }> }>(
        `${teamPath(id)}/members`,
      )
    ).members;
  }

  async setTeamMember(id: string, userId: string, active: boolean): Promise<void> {
    await this.request(`${teamPath(id)}/members/${encodeURIComponent(userId)}`, { method: active ? "PUT" : "DELETE" });
  }
}
