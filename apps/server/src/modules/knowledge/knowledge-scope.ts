import { type SqlBool, sql } from "kysely";
import type { PackageVisibilityFilter } from "../auth/namespace-access.js";

const projectColumn = sql.ref("knowledge_documents.project_id");

export function catalogKnowledge(visible?: PackageVisibilityFilter): PackageVisibilityFilter {
  return (db, column) =>
    visible
      ? sql<SqlBool>`${projectColumn} is null and ${visible(db, column)}`
      : sql<SqlBool>`${projectColumn} is null`;
}

export function projectKnowledge(projectId: string): PackageVisibilityFilter {
  return () => sql<SqlBool>`${projectColumn} = ${projectId}`;
}

export function withPackageVersions(
  packages: Array<{ name: string; version: string; artifactId?: string }>,
  visible?: PackageVisibilityFilter,
): PackageVisibilityFilter {
  const version = sql.ref("knowledge_documents.package_version");
  return (db, column) => {
    if (!packages.length) return sql<SqlBool>`1 = 0`;
    const scope = sql.join(
      packages.map((item) => {
        const match = sql`${sql.ref(column)} = ${item.name} and (${version} = ${item.version} or ${version} is null)`;
        if (!item.artifactId) return sql`(${match})`;
        const pin = db
          .selectFrom("packages")
          .select("artifact_id")
          .where("artifact_id", "=", item.artifactId)
          .whereRef("packages.name", "=", sql.ref(column))
          .where("version", "=", item.version);
        return sql`(${match} and exists ${pin})`;
      }),
      sql` or `,
    );
    return sql<SqlBool>`(${scope}) and ${catalogKnowledge(visible)(db, column)}`;
  };
}

export function projectContextKnowledge(
  projectId: string,
  packages: Parameters<typeof withPackageVersions>[0],
  visible: PackageVisibilityFilter | undefined,
  includeDocuments: boolean,
): PackageVisibilityFilter {
  const packageScope = withPackageVersions(packages, visible);
  if (!includeDocuments) return packageScope;
  return (db, column) => sql<SqlBool>`(${projectKnowledge(projectId)(db, column)} or (${packageScope(db, column)}))`;
}
