import { strictObject } from "../../infrastructure/http/json-schema.js";
import { PACKAGE_NAME_PATTERN } from "../packages/packages.schemas.js";

const knowledgeProperties = {
  title: { type: "string", minLength: 1, maxLength: 300 },
  content: { type: "string", minLength: 1, maxLength: 1_000_000 },
  tags: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } },
};
const modelProperty = { type: "string", minLength: 1, maxLength: 200 };
const vectorSchema = { type: "array", minItems: 1, maxItems: 8192, items: { type: "number" } };

export const createKnowledgeBody = strictObject(
  {
    ...knowledgeProperties,
    packageName: { type: "string", pattern: PACKAGE_NAME_PATTERN, maxLength: 214 },
  },
  ["title", "content"],
);

export const updateKnowledgeBody = strictObject(knowledgeProperties);

export const vectorBody = strictObject(
  {
    model: modelProperty,
    embedding: vectorSchema,
    sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  ["model", "embedding"],
);

export const vectorSearchBody = {
  type: "object",
  required: ["model", "embedding"],
  properties: {
    model: modelProperty,
    embedding: vectorSchema,
    limit: { type: "integer", minimum: 1, maximum: 50 },
    packageNames: { type: "array", maxItems: 200, items: { type: "string" } },
  },
};
