import type { Kysely } from "kysely";
import { type Migration, Migrator } from "kysely/migration";
import type { DialectName } from "../database-url.js";
import type { Schema } from "../schema.js";
import { createAuthTables } from "./auth-tables.js";
import { columnTypes } from "./column-types.js";
import { createKnowledgeTables, createMemoryTables } from "./context-tables.js";
import { createDirectoryTables, createRunTables } from "./directory-tables.js";
import { createOperationTables, createPackageTables } from "./package-tables.js";
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

export async function migrateToLatest(db: Kysely<Schema>, dialect: DialectName): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => ({ "0001-initial-schema": initialSchema(dialect) }) },
  });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(`No se pudo migrar la base de datos: ${String(error)}`);
}
