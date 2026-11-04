export type Role = "reader" | "publisher" | "worker" | "org-admin" | "admin";

export interface Identity {
  id: string;
  label: string;
  role: Role;
  projectIds: string[];
  organizationIds: string[];
  packageScopes: string[];
  kind?: "bootstrap" | "api-key" | "user";
  ownerId?: string;
  ownerName?: string;
  personalOwnerId?: string;
}

export interface KeyGrants {
  projectIds?: string[];
  organizationIds?: string[];
  packageScopes?: string[];
}

export interface Grantee {
  role: Role;
  projectIds: string[];
  organizationIds: string[];
  packageScopes: string[];
}

export interface KeyOptions {
  ownerId?: string | null;
  inherit?: boolean;
}

export interface KeyRecord extends Grantee {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  ownerId?: string;
  ownerName?: string;
  inherit: boolean;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  projectIds: string[];
  organizationIds: string[];
  packageScopes: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  disabledAt?: string;
}

export interface UserInput extends KeyGrants {
  username: string;
  displayName?: string;
  password: string;
  role: Role;
}

export interface UserUpdate extends KeyGrants {
  displayName?: string;
  role?: Role;
  disabled?: boolean;
  password?: string;
}

export interface NamespaceScope {
  all: boolean;
  namespaces: string[];
}

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
  publish: NamespaceScope;
  packages: NamespaceScope;
  organizations: Array<{ id: string; name: string; manage: boolean }>;
}

export const ROLES: Role[] = ["reader", "publisher", "worker", "org-admin", "admin"];
export const DELEGABLE_ROLES: Role[] = ["reader", "publisher", "worker", "org-admin"];
export const WRITER_ROLES: Role[] = ["publisher", "worker", "org-admin", "admin"];
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

export const namespaceOf = (packageName: string): string => packageName.split("/")[0];

export function userIdentity(user: UserRecord): Identity {
  return {
    id: user.id,
    label: user.username,
    role: user.role,
    projectIds: user.projectIds,
    organizationIds: user.organizationIds,
    packageScopes: user.packageScopes,
    kind: "user",
    personalOwnerId: user.id,
  };
}

export const personalNamespace = (username: string): string => `@${username}`;
