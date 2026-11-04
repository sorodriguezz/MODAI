export interface PackagesTable {
  name: string;
  version: string;
  type: string;
  description: string;
  manifest_json: string;
  artifact_id: string;
  published_at: string;
  status: string;
  deprecated_message: string | null;
  signer_fingerprint: string | null;
  signature: string | null;
  quality_json: string | null;
}

export interface ArtifactsTable {
  id: string;
  sha256: string;
  size_bytes: number;
  created_at: string;
}

export interface KnowledgeDocumentsTable {
  id: string;
  package_name: string | null;
  package_version: string | null;
  title: string;
  content: string;
  tags_json: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeVectorsTable {
  document_id: string;
  model: string;
  dimensions: number;
  embedding_blob: Uint8Array;
  updated_at: string;
}

export interface OrganizationsTable {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string | null;
}

export interface ProjectsTable {
  id: string;
  name: string;
  organization_id: string | null;
  created_by: string;
  created_at: string;
}

export interface NamespacesTable {
  name: string;
  organization_id: string | null;
  owner_user_id: string | null;
  description: string;
  visibility: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface MemoriesTable {
  id: string;
  project_id: string;
  organization_id: string | null;
  session_id: string | null;
  created_by: string | null;
  scope: string;
  kind: string;
  content: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface RunsTable {
  id: string;
  project_id: string;
  agent_name: string;
  agent_version: string;
  task: string;
  bundle_json: string;
  status: string;
  result: string | null;
  error: string | null;
  attempts: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  worker_id: string | null;
  lease_hash: string | null;
  lease_expires_at: string | null;
  idempotency_key: string | null;
}

export interface ProjectInstallationsTable {
  project_id: string;
  package_name: string;
  version: string;
  direct: number;
  reported_at: string;
}

export interface UsersTable {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: string;
  project_ids_json: string;
  organization_ids_json: string;
  package_scopes_json: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
}

export interface SessionsTable {
  token_hash: string;
  user_id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  absolute_expires_at: string;
  user_agent: string | null;
  ip: string | null;
}

export interface ApiKeysTable {
  id: string;
  label: string;
  token_hash: string;
  role: string;
  project_ids_json: string;
  organization_ids_json: string;
  package_scopes_json: string;
  owner_user_id: string | null;
  inherit_grants: number;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface PublishersTable {
  fingerprint: string;
  label: string | null;
  public_key: string;
  trusted: number;
  created_at: string;
}

export interface AuditLogTable {
  id: string;
  actor: string;
  action: string;
  resource: string;
  details_json: string;
  created_at: string;
}

export interface CategoriesTable {
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFtsTable {
  id: string;
  package_name: string | null;
  title: string;
  content: string;
  tags: string;
}

export interface MemoriesFtsTable {
  id: string;
  project_id: string;
  scope: string;
  kind: string;
  content: string;
}

export interface Schema {
  packages: PackagesTable;
  artifacts: ArtifactsTable;
  knowledge_documents: KnowledgeDocumentsTable;
  knowledge_vectors: KnowledgeVectorsTable;
  organizations: OrganizationsTable;
  projects: ProjectsTable;
  namespaces: NamespacesTable;
  memories: MemoriesTable;
  runs: RunsTable;
  project_installations: ProjectInstallationsTable;
  users: UsersTable;
  sessions: SessionsTable;
  api_keys: ApiKeysTable;
  publishers: PublishersTable;
  audit_log: AuditLogTable;
  categories: CategoriesTable;
  knowledge_fts: KnowledgeFtsTable;
  memories_fts: MemoriesFtsTable;
}
