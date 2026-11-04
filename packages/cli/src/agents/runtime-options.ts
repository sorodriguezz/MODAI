import type { Activation } from "@modai/contracts/types";
import type { RuntimeOptions } from "./runtime.js";

export interface ExecutionFlags {
  model?: string;
  url?: string;
  maxSteps?: string;
  allowMcp?: string[];
  allowEnv?: string[];
}

export function runtimeOptions(options: ExecutionFlags, activation?: Activation): RuntimeOptions {
  const maxSteps = options.maxSteps === undefined ? undefined : Number(options.maxSteps);
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 32))
    throw new Error("max-steps debe estar entre 1 y 32");
  return {
    cwd: process.cwd(),
    model: options.model,
    url: options.url,
    maxSteps,
    allowedMcp: options.allowMcp ?? activation?.allowedMcp ?? [],
    allowedEnv: options.allowEnv ?? activation?.allowedEnv ?? [],
  };
}
