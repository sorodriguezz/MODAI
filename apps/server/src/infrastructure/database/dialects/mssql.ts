import { type Dialect, MssqlDialect } from "kysely";
import type { ConnectionConfiguration } from "tedious";
import { loadDriver } from "./load-driver.js";

const flag = (url: URL, name: string, fallback: boolean): boolean => {
  const value = url.searchParams.get(name);
  return value === null ? fallback : value === "true" || value === "1";
};

export function mssqlConnectionConfig(value: string): ConnectionConfiguration {
  const url = new URL(value);
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || url.searchParams.get("database") || undefined;
  return {
    server: url.hostname,
    authentication: {
      type: "default",
      options: { userName: decodeURIComponent(url.username), password: decodeURIComponent(url.password) },
    },
    options: {
      port: url.port ? Number(url.port) : 1433,
      database,
      encrypt: flag(url, "encrypt", true),
      trustServerCertificate: flag(url, "trustServerCertificate", false),
    },
  };
}

export async function mssqlDialect(url: string): Promise<Dialect> {
  const tedious = await loadDriver(() => import("tedious"), "tedious", "SQL Server");
  const { default: tarn } = await loadDriver(() => import("tarn"), "tarn", "SQL Server");
  const config = mssqlConnectionConfig(url);
  return new MssqlDialect({
    tarn: { ...tarn, options: { min: 0, max: 10 } },
    tedious: { ...tedious, connectionFactory: () => new tedious.Connection(config) },
  });
}
