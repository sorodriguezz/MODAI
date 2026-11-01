import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";

export class Database {
  readonly connection: BetterSqlite3.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new BetterSqlite3(path);
    this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    this.connection.close();
  }

  private migrate(): void {
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
        updated_at TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        id UNINDEXED,
        package_name UNINDEXED,
        title,
        content,
        tags,
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        scope TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS knowledge_vectors (
        document_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        embedding_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        PRIMARY KEY(document_id, model)
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
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

    this.ensureColumn("packages", "status", "TEXT NOT NULL DEFAULT 'active'");
    this.ensureColumn("packages", "deprecated_message", "TEXT");
    this.ensureColumn("packages", "signer_fingerprint", "TEXT");
    this.ensureColumn("packages", "signature", "TEXT");
    this.ensureColumn("packages", "quality_json", "TEXT");
    this.ensureColumn("knowledge_documents", "updated_at", "TEXT");
    this.connection.prepare("UPDATE knowledge_documents SET updated_at = created_at WHERE updated_at IS NULL").run();
    const vectorColumns = this.connection.prepare("PRAGMA table_info(knowledge_vectors)").all() as Array<{ name: string; pk: number }>;
    if (!vectorColumns.some((c) => c.name === "model" && c.pk > 0)) {
      this.connection.transaction(() => {
        this.connection.exec(`CREATE TABLE knowledge_vectors_v2 (
          document_id TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL,
          embedding_json TEXT NOT NULL, updated_at TEXT NOT NULL,
          FOREIGN KEY(document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          PRIMARY KEY(document_id, model)
        );
        INSERT INTO knowledge_vectors_v2 SELECT document_id, model, dimensions, embedding_json, updated_at FROM knowledge_vectors;
        DROP TABLE knowledge_vectors;
        ALTER TABLE knowledge_vectors_v2 RENAME TO knowledge_vectors;`);
      })();
    }
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((item) => item.name === column)) {
      this.connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}
