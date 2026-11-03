import type { FeatureRule } from "../packages/feature-rules.js";

export const TEMPLATE_MANIFEST = "modai.template.yaml";
export const TEMPLATE_NAME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

export interface TemplatePackage {
  version: string;
  features: string[];
}
export interface TemplateFeature extends FeatureRule {
  path?: string;
  uses?: string;
  vars: Record<string, string>;
  packages: Record<string, TemplatePackage>;
}
export interface TemplateManifest {
  features: TemplateFeature[];
  addon?: { for: string[] };
}
export interface TemplateFile {
  path: string;
  content: string;
}

export const templateProblem = (message: string): never => {
  throw new Error(`${TEMPLATE_MANIFEST}: ${message}`);
};

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const stringList = (value: unknown, label: string): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    templateProblem(`${label} debe ser una lista de nombres`);
  return value as string[];
};
