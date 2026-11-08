import type { AgentBundle } from "@modai/contracts/types";
import type { Kysely } from "kysely";
import { bundlePackageNames } from "../../../modules/runs/bundle-packages.js";
import type { DialectName } from "../database-url.js";
import type { Schema } from "../schema.js";
import { limitRows } from "../sql-helpers.js";
import type { ColumnTypes } from "./column-types.js";

export async function createExecutionTables(db: Kysely<unknown>, t: ColumnTypes, dialect: DialectName): Promise<void> {
  await db.schema
    .createTable("project_execution_policies")
    .addColumn("project_id", t.key(200), (col) => col.primaryKey())
    .addColumn("policy_json", t.text, (col) => col.notNull())
    .addForeignKeyConstraint("fk_execution_policy_project", ["project_id"], "projects", ["id"], (fk) =>
      fk.onDelete("cascade"),
    )
    .execute();
  await db.schema
    .createTable("run_packages")
    .addColumn("run_id", t.key(100), (col) => col.notNull())
    .addColumn("package_name", t.key(214), (col) => col.notNull())
    .addPrimaryKeyConstraint("pk_run_package", ["run_id", "package_name"])
    .addForeignKeyConstraint("fk_run_package", ["run_id"], "runs", ["id"], (fk) => fk.onDelete("cascade"))
    .execute();
  const typed = db as unknown as Kysely<Schema>;
  let lastId = "";
  while (true) {
    const query = typed.selectFrom("runs").select(["id", "bundle_json"]).where("id", ">", lastId).orderBy("id");
    const runs = await limitRows(query, dialect, 100).execute();
    if (!runs.length) return;
    for (const row of runs) {
      const names = bundlePackageNames(JSON.parse(row.bundle_json) as AgentBundle);
      await typed
        .insertInto("run_packages")
        .values(names.map((package_name) => ({ run_id: row.id, package_name })))
        .execute();
    }
    lastId = runs.at(-1)!.id;
  }
}
