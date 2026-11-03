import { z } from "zod";
import { capabilityIdSchema, rangeSchema, semverSchema } from "./shared.js";

function splitCapabilityReference(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const at = value.indexOf("@");
  return at < 0 ? { capability: value } : { capability: value.slice(0, at), version: value.slice(at + 1) };
}

const capabilityReferenceSchema = (defaultVersion: string, isRange: boolean) =>
  z.preprocess(
    splitCapabilityReference,
    z
      .object({
        capability: capabilityIdSchema,
        version: (isRange ? rangeSchema : semverSchema).default(defaultVersion),
        description: z.string().max(1000).optional(),
      })
      .strict(),
  );
export const providedCapabilitySchema = capabilityReferenceSchema("1.0.0", false);
export const requiredCapabilitySchema = capabilityReferenceSchema("*", true);

export type ProvidedCapability = { capability: string; version: string; description?: string };
export type RequiredCapability = { capability: string; version: string; description?: string };
