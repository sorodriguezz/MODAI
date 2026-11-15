export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  projectId?: string | null;
  packageName?: string | null;
  packageVersion?: string | null;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface KnowledgeSearchResult extends KnowledgeDocument {
  rank: number;
}

export interface KnowledgeVectorResult extends KnowledgeDocument {
  score: number;
}

export type Role = "reader" | "publisher" | "worker" | "org-admin" | "admin";

export interface Permissions {
  role: Role;
  global: boolean;
  manage: {
    users: boolean;
    apiKeys: boolean;
    organizations: boolean;
    createOrganizations: boolean;
    namespaces: boolean;
    audit: boolean;
    publishers: boolean;
    backup: boolean;
    packages: boolean;
  };
  assignableRoles: Role[];
  createProjects: boolean;
  writeKnowledge: boolean;
  writeMemory: boolean;
  submitRuns: boolean;
  publish: { all: boolean; namespaces: string[] };
  packages: { all: boolean; namespaces: string[] };
  organizations: Array<{ id: string; name: string; manage: boolean }>;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  description: string;
  projects: number;
  namespaces: number;
  members: number;
  canManage: boolean;
}
export interface CategoryRecord {
  name: string;
  description: string;
  registered: boolean;
  packages: number;
  createdAt?: string;
  updatedAt?: string;
}
export interface NamespaceOwner {
  organizationId?: string | null;
  ownerUserId?: string | null;
}

export interface NamespaceRecord {
  name: string;
  ownerKind: "organization" | "user";
  organizationId?: string;
  organizationName?: string;
  ownerUserId?: string;
  ownerUsername?: string;
  description: string;
  visibility: "internal" | "restricted" | "shared";
  packages: number;
  canManage: boolean;
  canPublish: boolean;
}

export interface AccessGrants {
  projectIds: string[];
  organizationIds: string[];
  packageScopes: string[];
}

export interface ApiKeyRecord extends AccessGrants {
  id: string;
  label: string;
  role: Role;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  ownerId?: string;
  ownerName?: string;
  inherit: boolean;
}
export interface UserRecord extends AccessGrants {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
  lastLoginAt?: string;
  disabledAt?: string;
}
