import { existsSync, readFileSync } from "node:fs";
import type { Activation } from "@modai/contracts/types";
import { safeProjectPath, writeProjectFile } from "@modai/core/installation/fs";

const START = "<!-- modai:agent:start -->";
const END = "<!-- modai:agent:end -->";
const AGENT_ROUTER_BLOCK = `${START}\nLee y aplica las instrucciones del agente en \`.modai/agent.md\`. Usa el servidor MCP \`modai\` del proyecto para consultar sus capacidades.\n${END}`;

export const hostFileOf = (adapter: Activation["adapter"]) =>
  adapter === "agents-md" ? "AGENTS.md" : adapter === "claude-md" ? "CLAUDE.md" : undefined;

export function writeRouterBlock(root: string, hostFile: string): void {
  const path = safeProjectPath(root, hostFile);
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const start = content.indexOf(START),
    end = content.indexOf(END);
  if (start < 0 !== end < 0 || (start >= 0 && end < start)) throw new Error(`Bloque MODAI incompleto en ${hostFile}`);
  writeProjectFile(
    root,
    hostFile,
    start < 0
      ? `${content}${content ? "\n\n" : ""}${AGENT_ROUTER_BLOCK}\n`
      : content.slice(0, start) + AGENT_ROUTER_BLOCK + content.slice(end + END.length),
  );
}

export function removeRouterBlock(root: string, hostFile: string): boolean {
  const path = safeProjectPath(root, hostFile);
  if (!existsSync(path)) return false;
  const content = readFileSync(path, "utf8");
  const cleaned = content.replace(`${AGENT_ROUTER_BLOCK}\n`, "").replace(AGENT_ROUTER_BLOCK, "");
  if (cleaned !== content) writeProjectFile(root, hostFile, cleaned.replace(/\n{3,}$/, "\n"));
  else if (content.includes(START)) return true;
  return false;
}
