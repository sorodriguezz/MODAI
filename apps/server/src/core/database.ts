import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";

/**
 * SQLite database. There is a single schema: the tables are created on first start and never altered afterwards.
 * Changing the schema means starting from a new database file.
 */
export class Database {
  readonly connection: BetterSqlite3.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new BetterSqlite3(path);
    this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.createSchema();
  }

  close(): void {
    this.connection.close();
  }

  private createSchema(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS packages (
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        published_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        deprecated_message TEXT,
        signer_fingerprint TEXT,
        signature TEXT,
        quality_json TEXT,
        PRIMARY KEY (name, version)
      );
      CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
      CREATE INDEX IF NOT EXISTS idx_packages_type ON packages(type);

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        package_name TEXT,
        package_version TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        id UNINDEXED,
        package_name UNINDEXED,
        title,
        content,
        tags,
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS knowledge_vectors (
        document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        embedding_blob BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (document_id, model)
      );
      CREATE INDEX IF NOT EXISTS idx_vector_space ON knowledge_vectors(model, dimensions);

      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        organization_id TEXT REFERENCES organizations(id),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(created_by);
      CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
      CREATE TABLE IF NOT EXISTS namespaces (
        name TEXT PRIMARY KEY,
        organization_id TEXT REFERENCES organizations(id),
        description TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','restricted')),
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_namespaces_org ON namespaces(organization_id);

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        organization_id TEXT,
        session_id TEXT,
        created_by TEXT,
        scope TEXT NOT NULL CHECK (scope IN ('project','organization','session')),
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id, updated_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        project_id UNINDEXED,
        scope UNINDEXED,
        kind,
        content,
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        agent_name TEXT NOT NULL,
        agent_version TEXT NOT NULL,
        task TEXT NOT NULL,
        bundle_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        worker_id TEXT,
        lease_hash TEXT,
        lease_expires_at TEXT,
        idempotency_key TEXT,
        UNIQUE(project_id, created_by, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_runs_queue ON runs(project_id, status, created_at);

      -- What each project has installed, as last reported by a client after \`modai sync\`.
      CREATE TABLE IF NOT EXISTS project_installations (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        package_name TEXT NOT NULL,
        version TEXT NOT NULL,
        direct INTEGER NOT NULL DEFAULT 0,
        reported_at TEXT NOT NULL,
        PRIMARY KEY (project_id, package_name)
      );
      CREATE INDEX IF NOT EXISTS idx_installations_package ON project_installations(package_name);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('reader','publisher','worker','org-admin','admin')),
        project_ids_json TEXT NOT NULL DEFAULT '[]',
        organization_ids_json TEXT NOT NULL DEFAULT '[]',
        package_scopes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT,
        disabled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        user_agent TEXT,
        ip TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

      -- An API key belongs to a user and never exceeds that user's permissions; keys without owner are service keys.
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        project_ids_json TEXT NOT NULL DEFAULT '[]',
        organization_ids_json TEXT NOT NULL DEFAULT '[]',
        package_scopes_json TEXT NOT NULL DEFAULT '[]',
        owner_user_id TEXT,
        inherit_grants INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS publishers (
        fingerprint TEXT PRIMARY KEY,
        label TEXT,
        public_key TEXT NOT NULL,
        trusted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    `);
  }
}
