import type { SignaturePolicy } from "@modai/contracts/types";
import type { Database } from "../infrastructure/database/database.js";
import { ArtifactStore } from "../infrastructure/storage/artifact-store.js";
import { AuditService } from "./admin/audit.service.js";
import { BackupService } from "./admin/backup.service.js";
import { MetricsService } from "./admin/metrics.service.js";
import { AgentsService } from "./agents/agents.service.js";
import { ApiKeysService } from "./auth/api-keys.service.js";
import { AuthorizationService } from "./auth/authorization.service.js";
import { SessionsService } from "./auth/sessions.service.js";
import { UsersService } from "./auth/users.service.js";
import { CategoriesService } from "./categories/categories.service.js";
import { KnowledgeService } from "./knowledge/knowledge.service.js";
import { MemoryService } from "./memory/memory.service.js";
import { NamespacesService } from "./namespaces/namespaces.service.js";
import { OrganizationsService } from "./organizations/organizations.service.js";
import { PackagesService } from "./packages/packages.service.js";
import { ProfilesService } from "./profiles/profiles.service.js";
import { TeamsService } from "./profiles/teams.service.js";
import { ProjectsService } from "./projects/projects.service.js";
import { ExecutionPolicies } from "./runs/execution-policy.js";
import { RunsService } from "./runs/runs.service.js";

export interface ServiceOptions {
  artifactDirectory: string;
  apiToken?: string;
  signaturePolicy: SignaturePolicy;
  maxArtifactStorageBytes?: number;
  workerLeaseMs?: number;
  sessionIdleMs?: number;
  sessionMaxMs?: number;
}

export interface Services {
  database: Database;
  authz: AuthorizationService;
  users: UsersService;
  sessions: SessionsService;
  apiKeys: ApiKeysService;
  organizations: OrganizationsService;
  namespaces: NamespacesService;
  projects: ProjectsService;
  profiles: ProfilesService;
  teams: TeamsService;
  packages: PackagesService;
  categories: CategoriesService;
  knowledge: KnowledgeService;
  memory: MemoryService;
  agents: AgentsService;
  runs: RunsService;
  executionPolicies: ExecutionPolicies;
  audit: AuditService;
  backup: BackupService;
  metrics: MetricsService;
}

export function createServices(database: Database, options: ServiceOptions): Services {
  const authz = new AuthorizationService(database);
  const organizations = new OrganizationsService(database, authz);
  const packages = new PackagesService(database, {
    artifacts: new ArtifactStore(options.artifactDirectory),
    signaturePolicy: options.signaturePolicy,
    maxStorageBytes: options.maxArtifactStorageBytes ?? 1024 * 1024 * 1024,
  });
  const knowledge = new KnowledgeService(database);
  const memory = new MemoryService(database);
  const projects = new ProjectsService(database, authz, organizations);
  const teams = new TeamsService(database, authz, organizations);
  return {
    database,
    authz,
    users: new UsersService(database),
    sessions: new SessionsService(database, { idleMs: options.sessionIdleMs, absoluteMs: options.sessionMaxMs }),
    apiKeys: new ApiKeysService(database, authz, options.apiToken),
    organizations,
    namespaces: new NamespacesService(database, authz, organizations),
    projects,
    profiles: new ProfilesService(database, authz, projects, organizations, teams, packages),
    teams,
    packages,
    categories: new CategoriesService(database),
    knowledge,
    memory,
    agents: new AgentsService(packages),
    runs: new RunsService(database, options.workerLeaseMs),
    executionPolicies: new ExecutionPolicies(database),
    audit: new AuditService(database),
    backup: new BackupService(database, packages, knowledge, memory),
    metrics: new MetricsService(),
  };
}
