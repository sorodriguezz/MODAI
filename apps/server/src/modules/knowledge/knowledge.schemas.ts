import { PACKAGE_NAME_PATTERN } from "../packages/packages.schemas.js";

const knowledgeProperties = {
  title: { type: "string", minLength: 1, maxLength: 300 },
  content: { type: "string", minLength: 1, maxLength: 1_000_000 },
  tags: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } },
};
const vectorSchema = { type: "array", minItems: 1, maxItems: 8192, items: { type: "number" } };

export const createKnowledgeBody = {
  type: "object",
  required: ["title", "content"],
  additionalProperties: false,
  properties: {
    ...knowledgeProperties,
    packageName: { type: "string", pattern: PACKAGE_NAME_PATTERN, maxLength: 214 },
  },
};

export const updateKnowledgeBody = { type: "object", additionalProperties: false, properties: knowledgeProperties };

export const vectorBody = {
  type: "object",
  required: ["model", "embedding"],
  additionalProperties: false,
  properties: {
    model: { type: "string", minLength: 1, maxLength: 200 },
    embedding: vectorSchema,
    sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};

export const vectorSearchBody = {
  type: "object",
  required: ["model", "embedding"],
  properties: {
    model: { type: "string", minLength: 1, maxLength: 200 },
    embedding: vectorSchema,
    limit: { type: "integer", minimum: 1, maximum: 50 },
    packageNames: { type: "array", maxItems: 200, items: { type: "string" } },
  },
};
