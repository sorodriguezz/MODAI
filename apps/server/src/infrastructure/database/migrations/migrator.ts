import type { Kysely } from "kysely";
import { type Migration, Migrator } from "kysely/migration";
import type { DialectName } from "../database-url.js";
import type { Schema } from "../schema.js";
import { createAuthTables } from "./auth-tables.js";
import { columnTypes } from "./column-types.js";
import { createKnowledgeTables, createMemoryTables } from "./context-tables.js";
import { createDirectoryTables, createRunTables } from "./directory-tables.js";
import { createExecutionTables } from "./execution-tables.js";
import { addMemoryGovernance } from "./memory-governance.js";
import { createOperationTables, createPackageTables } from "./package-tables.js";
import { createProfileTables } from "./profile-tables.js";
import { createSearchIndexes } from "./search-indexes.js";
import { seedCategories } from "./seed-categories.js";

function initialSchema(dialect: DialectName): Migration {
  return {
    async up(db: Kysely<unknown>) {
      const types = columnTypes(dialect);
      await createPackageTables(db, types);
      await createOperationTables(db, types);
      await createKnowledgeTables(db, types);
      await createMemoryTables(db, types);
      await createDirectoryTables(db, types);
      await createRunTables(db, types, dialect);
      await createAuthTables(db, types);
      await createSearchIndexes(db, dialect);
      await seedCategories(db);
    },
  };
}

function namespaceSharing(dialect: DialectName): Migration {
  return {
    async up(db) {
      await db.schema
        .alterTable("namespaces")
        .addColumn("instance_shared", columnTypes(dialect).integer, (col) => col.notNull().defaultTo(0))
        .execute();
    },
  };
}

function projectKnowledge(dialect: DialectName): Migration {
  return {
    async up(db) {
      await db.schema
        .alterTable("knowledge_documents")
        .addColumn("project_id", columnTypes(dialect).key(200), (col) =>
          col.references("projects.id").onDelete("cascade"),
        )
        .execute();
      await db.schema
        .createIndex("idx_knowledge_project")
        .on("knowledge_documents")
        .columns(["project_id", "updated_at", "id"])
        .execute();
    },
  };
}

export async function migrateToLatest(db: Kysely<Schema>, dialect: DialectName): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: {
      getMigrations: async () => ({
        "0001-initial-schema": initialSchema(dialect),
        "0002-namespace-sharing": namespaceSharing(dialect),
        "0003-effective-profiles": { up: (db) => createProfileTables(db, columnTypes(dialect)) },
        "0004-execution-scope": { up: (db) => createExecutionTables(db, columnTypes(dialect), dialect) },
        "0005-memory-governance": { up: (db) => addMemoryGovernance(db, columnTypes(dialect)) },
        "0006-project-knowledge": projectKnowledge(dialect),
        "0007-user-mfa": {
          async up(db) {
            const types = columnTypes(dialect);
            await db.schema.alterTable("users").addColumn("mfa_secret", types.key(160)).execute();
            await db.schema.alterTable("users").addColumn("mfa_last_step", types.integer).execute();
            await db.schema.alterTable("users").addColumn("mfa_recovery_json", types.text).execute();
          },
        },
      }),
    },
  });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(`No se pudo migrar la base de datos: ${String(error)}`);
}
