import { type Expression, type SqlBool, sql } from "kysely";
import type { Executor } from "../../infrastructure/database/database.js";
import type { DialectName } from "../../infrastructure/database/database-url.js";
import type { Identity } from "./identity.js";

export const allNamespaces = (actor: Identity) => actor.role === "admin" || actor.packageScopes.includes("*");

export function readableNamespaces(db: Executor, actor: Identity) {
  const namespaces = db.selectFrom("namespaces").select("name");
  if (allNamespaces(actor)) return namespaces;
  return namespaces.where((eb) =>
    eb.or([
      eb("instance_shared", "=", 1),
      ...(actor.packageScopes.length ? [eb("name", "in", actor.packageScopes)] : []),
      ...(actor.personalOwnerId ? [eb("owner_user_id", "=", actor.personalOwnerId)] : []),
      ...(actor.organizationIds.length
        ? [
            eb.and([
              eb("organization_id", "in", actor.organizationIds),
              ...(actor.role === "org-admin" ? [] : [eb("visibility", "=", "internal")]),
            ]),
          ]
        : []),
    ]),
  );
}

function namespaceExpression(dialect: DialectName, column: string) {
  const name = sql.ref(column);
  if (dialect === "sqlite") return sql<string>`substr(${name}, 1, instr(${name}, '/') - 1)`;
  if (dialect === "postgres") return sql<string>`split_part(${name}, '/', 1)`;
  if (dialect === "mysql") return sql<string>`substring_index(${name}, '/', 1)`;
  return sql<string>`left(${name}, charindex('/', concat(${name}, '/')) - 1)`;
}

export type PackageVisibilityFilter = (db: Executor, column: string) => Expression<SqlBool>;

export function packageVisibilityFilter(dialect: DialectName, actor: Identity): PackageVisibilityFilter | undefined {
  if (allNamespaces(actor)) return undefined;
  return (db, column) =>
    sql<SqlBool>`(${sql.ref(column)} is null or ${namespaceExpression(dialect, column)} in (${readableNamespaces(db, actor)}))`;
}
