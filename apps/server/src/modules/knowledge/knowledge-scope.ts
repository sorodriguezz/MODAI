import { type SqlBool, sql } from "kysely";
import type { PackageVisibilityFilter } from "../auth/namespace-access.js";

export function withPackageVersions(
  packages: Array<{ name: string; version: string }>,
  visible?: PackageVisibilityFilter,
): PackageVisibilityFilter {
  const version = sql.ref("knowledge_documents.package_version");
  return (db, column) => {
    if (!packages.length) return sql<SqlBool>`1 = 0`;
    const scope = sql.join(
      packages.map(
        (item) => sql`(${sql.ref(column)} = ${item.name} and (${version} = ${item.version} or ${version} is null))`,
      ),
      sql` or `,
    );
    return visible ? sql<SqlBool>`(${scope}) and ${visible(db, column)}` : sql<SqlBool>`(${scope})`;
  };
}
