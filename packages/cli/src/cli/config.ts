import type { SignaturePolicy } from "@modai/contracts/types";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";

export interface ClientConfig {
  /** Absent after `modai logout`; trust settings survive a logout. */
  server?: string;
  token?: string;
  signaturePolicy?: SignaturePolicy;
  trustedPublishers?: string[];
}

export const clientConfigPath = join(process.env.MODAI_CONFIG_DIR ?? join(homedir(), ".modai"), "client.yaml");

export function readYaml<T>(path: string): T {
  return YAML.parse(readFileSync(path, "utf8")) as T;
}

export function writeYaml(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, YAML.stringify(value, { lineWidth: 0 }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

export function loadClientConfig(): ClientConfig | undefined {
  if (!existsSync(clientConfigPath)) return undefined;
  return readYaml<ClientConfig>(clientConfigPath);
}

export function saveClientConfig(config: ClientConfig): void {
  writeYaml(clientConfigPath, config);
}
