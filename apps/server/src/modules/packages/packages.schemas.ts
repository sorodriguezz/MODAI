import { strictObject } from "../../infrastructure/http/json-schema.js";

export const PACKAGE_NAME_PATTERN = "^@[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*$";
const LARGE_STRING = 36 * 1024 * 1024;
const SHA256_PATTERN = "^[a-f0-9]{64}$";

const versionProperty = { type: "string", minLength: 1, maxLength: 100 };
const versionRef = {
  name: { type: "string", pattern: PACKAGE_NAME_PATTERN, maxLength: 214 },
  version: versionProperty,
};

const versionBody = (field: string, maxLength: number) =>
  strictObject({ ...versionRef, [field]: { type: "string", maxLength } }, ["name", "version", field]);

export const deprecateBody = versionBody("message", 1000);
export const yankBody = versionBody("reason", 1000);
export const deleteBody = versionBody("confirmation", 330);

const installedPackage = strictObject(
  {
    name: { type: "string", minLength: 3, maxLength: 214, pattern: PACKAGE_NAME_PATTERN },
    version: versionProperty,
    direct: { type: "boolean" },
  },
  ["name", "version"],
);

export const installationsBody = strictObject(
  { packages: { type: "array", maxItems: 1000, items: installedPackage } },
  ["packages"],
);

export const importSkillBody = strictObject(
  {
    archive: { type: "string", minLength: 1, maxLength: LARGE_STRING },
    namespace: { type: "string", pattern: "^@[a-z0-9][a-z0-9._-]*$" },
    version: { type: "string", maxLength: 100 },
    name: { type: "string", maxLength: 64 },
    dryRun: { type: "boolean" },
  },
  ["archive", "namespace"],
);

const templateDeclaration = strictObject({
  features: { type: "object", maxProperties: 50, additionalProperties: { type: "object" } },
  addon: strictObject({ for: { type: "array", maxItems: 50, items: { type: "string", maxLength: 214 } } }, ["for"]),
});

const templateFile = strictObject(
  {
    path: { type: "string", maxLength: 1024 },
    content: { type: "string" },
    sha256: { type: "string", pattern: SHA256_PATTERN },
  },
  ["path", "content", "sha256"],
);

export const importTemplateBody = strictObject(
  {
    name: { type: "string", maxLength: 214 },
    version: { type: "string", maxLength: 100 },
    description: { type: "string", maxLength: 5000 },
    category: { type: "string", maxLength: 64 },
    keywords: { type: "array", maxItems: 50, items: { type: "string", maxLength: 64 } },
    declaration: templateDeclaration,
    archive: { type: "string", maxLength: LARGE_STRING },
    files: { type: "array", maxItems: 5000, items: templateFile },
  },
  ["name", "version", "description"],
);

export const registerPublisherBody = strictObject(
  {
    publicKey: { type: "string", maxLength: 4096 },
    label: { type: "string", maxLength: 200 },
    trusted: { type: "boolean" },
  },
  ["publicKey", "label", "trusted"],
);

export const trustPublisherBody = strictObject(
  { trusted: { type: "boolean" }, label: { type: "string", maxLength: 200 } },
  ["trusted"],
);
