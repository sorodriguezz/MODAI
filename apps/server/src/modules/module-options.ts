import type { SignaturePolicy } from "@modai/contracts/types";
import type { Services } from "./services.js";

export interface ModuleConfig {
  publicUrl?: string;
  signaturePolicy: SignaturePolicy;
  loginRateLimitMax?: number;
  loginDelayMs?: number;
}

export interface ModuleOptions {
  services: Services;
  config: ModuleConfig;
}

export const LARGE_BODY = 36 * 1024 * 1024;
