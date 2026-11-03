import { z } from "zod";

export const API_VERSION = "modai.dev/v1" as const;

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const semverSchema = z.string().max(100).regex(semverPattern, "Debe ser una versión SemVer exacta");
export const rangeSchema = z.string().min(1).max(100);
export const capabilityIdSchema = z
  .string()
  .max(128)
  .regex(
    /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/,
    "Usa un identificador con puntos, por ejemplo browser.automation",
  );
export const categorySchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, "category usa minúsculas y guiones");
export const relativePathSchema = z.string().min(1).max(1024);
export const contributionNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Usa minúsculas, números y guiones (máx. 64)");
export const packageNameSchema = z.string().regex(/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/);
export const signaturePolicySchema = z.enum(["optional", "signed", "trusted"]);
