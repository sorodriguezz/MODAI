export const PACKAGE_NAME_PATTERN = "^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$";
const LARGE_STRING = 36 * 1024 * 1024;

const versionRef = {
  name: { type: "string", pattern: PACKAGE_NAME_PATTERN, maxLength: 214 },
  version: { type: "string", minLength: 1, maxLength: 100 },
};

const versionBody = (field: string, maxLength: number) => ({
  type: "object",
  required: ["name", "version", field],
  additionalProperties: false,
  properties: { ...versionRef, [field]: { type: "string", maxLength } },
});

export const deprecateBody = versionBody("message", 1000);
export const yankBody = versionBody("reason", 1000);
export const deleteBody = versionBody("confirmation", 330);

export const installationsBody = {
  type: "object",
  required: ["packages"],
  additionalProperties: false,
  properties: {
    packages: {
      type: "array",
      maxItems: 1000,
      items: {
        type: "object",
        required: ["name", "version"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 3, maxLength: 214, pattern: PACKAGE_NAME_PATTERN },
          version: { type: "string", minLength: 1, maxLength: 100 },
          direct: { type: "boolean" },
        },
      },
    },
  },
};

export const importSkillBody = {
  type: "object",
  required: ["archive", "namespace"],
  additionalProperties: false,
  properties: {
    archive: { type: "string", minLength: 1, maxLength: LARGE_STRING },
    namespace: { type: "string", pattern: "^@[a-z0-9][a-z0-9._-]*$" },
    version: { type: "string", maxLength: 100 },
    name: { type: "string", maxLength: 64 },
    dryRun: { type: "boolean" },
  },
};

export const importTemplateBody = {
  type: "object",
  required: ["name", "version", "description"],
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 214 },
    version: { type: "string", maxLength: 100 },
    description: { type: "string", maxLength: 5000 },
    category: { type: "string", maxLength: 64 },
    keywords: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } },
    declaration: {
      type: "object",
      additionalProperties: false,
      properties: {
        features: { type: "object", maxProperties: 50, additionalProperties: { type: "object" } },
        addon: {
          type: "object",
          additionalProperties: false,
          required: ["for"],
          properties: { for: { type: "array", maxItems: 50, items: { type: "string", maxLength: 214 } } },
        },
      },
    },
    archive: { type: "string", maxLength: LARGE_STRING },
    files: {
      type: "array",
      maxItems: 5000,
      items: {
        type: "object",
        required: ["path", "content", "sha256"],
        additionalProperties: false,
        properties: {
          path: { type: "string", maxLength: 1024 },
          content: { type: "string" },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        },
      },
    },
  },
};

export const registerPublisherBody = {
  type: "object",
  required: ["publicKey", "label", "trusted"],
  properties: {
    publicKey: { type: "string", maxLength: 4096 },
    label: { type: "string", maxLength: 200 },
    trusted: { type: "boolean" },
  },
  additionalProperties: false,
};

export const trustPublisherBody = {
  type: "object",
  required: ["trusted"],
  additionalProperties: false,
  properties: { trusted: { type: "boolean" }, label: { type: "string", maxLength: 200 } },
};
