import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { sha256 } from "@modai/contracts/security";
import type { Permission } from "@modai/contracts/types";

export interface LocalApproval { permissions: Permission[]; digest?: string; allowedTools?: string[]; allowedMcp?: string[]; allowedEnv?: string[] }
const approvalPath = () => join(process.env.MODAI_CONFIG_DIR ?? join(homedir(), ".modai"), "approvals.json");
function key(root: string, projectId: string, server?: string) { return sha256(JSON.stringify([realpathSync(root),projectId,server?.replace(/\/+$/,"")])); }
function read(): Record<string, LocalApproval> { return existsSync(approvalPath()) ? JSON.parse(readFileSync(approvalPath(),"utf8")) : {}; }
export function localApproval(root: string, projectId: string, server?: string): LocalApproval { return read()[key(root,projectId,server)] ?? { permissions: [] }; }
export function saveLocalApproval(root: string, projectId: string, server: string | undefined, approval: LocalApproval): void {
  const path=approvalPath(),values=read();values[key(root,projectId,server)]=approval;
  mkdirSync(dirname(path),{recursive:true,mode:0o700});const temporary=`${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary,JSON.stringify(values,null,2)+"\n",{mode:0o600,flag:"wx"});renameSync(temporary,path);
}
