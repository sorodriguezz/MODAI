import { chownSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function chownTree(path: string, uid: number, gid: number): void {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return;
  if (info.uid !== uid || info.gid !== gid) chownSync(path, uid, gid);
  if (info.isDirectory()) for (const entry of readdirSync(path)) chownTree(join(path, entry), uid, gid);
}

if (process.getuid?.() === 0 && process.env.MODAI_RUN_AS_ROOT !== "true") {
  const uid = Number(process.env.MODAI_RUN_UID ?? 1000);
  const gid = Number(process.env.MODAI_RUN_GID ?? uid);
  const directories = [
    dirname(resolve(process.env.MODAI_DATABASE_PATH ?? "/app/data/modularai.db")),
    resolve(process.env.MODAI_ARTIFACT_DIR ?? "/app/artifacts"),
  ];
  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
    const info = lstatSync(directory);
    if (info.uid !== uid || info.gid !== gid) chownTree(directory, uid, gid);
  }
  process.setgroups?.([gid]);
  process.setgid!(gid);
  process.setuid!(uid);
}

await import("./main.js");
