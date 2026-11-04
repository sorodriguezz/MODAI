import type { AuditService } from "../admin/audit.service.js";
import type { UsersService } from "./users.service.js";

export async function seedInitialAdmin(
  users: UsersService,
  audit: AuditService,
  initial?: { username: string; password: string } | false,
): Promise<void> {
  const fromEnv = process.env.MODAI_ADMIN_USERNAME?.trim()
    ? { username: process.env.MODAI_ADMIN_USERNAME, password: process.env.MODAI_ADMIN_PASSWORD ?? "" }
    : undefined;
  const seed = initial === false ? undefined : (initial ?? fromEnv);
  if (!seed || (await users.userCount()) > 0) return;
  try {
    const user = await users.seedAdmin(seed.username, seed.password);
    if (user) await audit.record("system", "user.seed", `user:${user.username}`, { role: user.role });
  } catch (error) {
    throw new Error(
      `No se pudo crear el administrador inicial (MODAI_ADMIN_USERNAME/MODAI_ADMIN_PASSWORD): ${(error as Error).message}`,
    );
  }
}
