import { type Dialect, MysqlDialect } from "kysely";
import { loadDriver } from "./load-driver.js";

export async function mysqlDialect(url: string): Promise<Dialect> {
  const { default: mysql } = await loadDriver(() => import("mysql2"), "mysql2", "MySQL");
  return new MysqlDialect({ pool: mysql.createPool({ uri: url, connectionLimit: 10, charset: "utf8mb4" }) });
}
