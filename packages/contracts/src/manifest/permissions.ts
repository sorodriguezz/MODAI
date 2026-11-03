import { z } from "zod";

export const PERMISSIONS_V1 = [
  "project.instructions",
  "project.files",
  "project.source",
  "process.execute",
  "mcp.connect",
  "filesystem.read",
  "filesystem.write",
  "network",
  "env.read",
] as const;
export const permissionV1Schema = z.enum(PERMISSIONS_V1);
export type PermissionV1 = (typeof PERMISSIONS_V1)[number];
