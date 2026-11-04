import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configDirectory } from "@modai/core";
import semver from "semver";
import { fetchDistTag } from "./upgrade.js";

const DAY_MS = 24 * 60 * 60 * 1000;

interface UpdateCache {
  checkedAt: string;
  latest: string;
}
const cachePath = () => join(configDirectory(), "update-check.json");

export function readUpdateCache(): UpdateCache | undefined {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf8")) as UpdateCache;
  } catch {
    return undefined;
  }
}

export function writeUpdateCache(latest: string): void {
  try {
    mkdirSync(configDirectory(), { recursive: true });
    writeFileSync(cachePath(), `${JSON.stringify({ checkedAt: new Date().toISOString(), latest })}\n`);
  } catch {
    return;
  }
}

export function noticeEnabled(env = process.env, interactive = Boolean(process.stderr.isTTY)): boolean {
  return interactive && !env.CI && !env.MODAI_NO_UPDATE_NOTIFIER && env.NODE_ENV !== "test";
}

export function startUpdateNotice(current: string, now = Date.now()): () => void {
  if (!noticeEnabled()) return () => {};
  const cache = readUpdateCache();
  if (!cache || now - Date.parse(cache.checkedAt) > DAY_MS)
    fetchDistTag("latest", 1500).then(writeUpdateCache, () => writeUpdateCache(cache?.latest ?? current));
  return () => {
    if (cache && semver.valid(cache.latest) && semver.valid(current) && semver.gt(cache.latest, current)) {
      process.stderr.write(
        `\nHay una versión nueva de MODAI: ${current} → ${cache.latest}\nActualiza con: modai upgrade\n`,
      );
    }
  };
}
