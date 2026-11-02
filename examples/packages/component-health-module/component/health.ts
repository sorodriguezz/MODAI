// Health check sin dependencias. Registra tus comprobaciones (base de datos, colas…) en `checks`.
export type Check = () => Promise<void>;

export async function health(checks: Record<string, Check> = {}, version = process.env.npm_package_version ?? "0.0.0") {
  const results = await Promise.all(Object.entries(checks).map(async ([name, check]) => {
    try { await check(); return [name, "ok"] as const; }
    catch (error) { return [name, (error as Error).message || "error"] as const; }
  }));
  const dependencies = Object.fromEntries(results);
  const ok = results.every(([, status]) => status === "ok");
  return { status: ok ? "ok" : "degraded", version, uptime: Math.round(process.uptime()), dependencies };
}
