import { ROLES } from "./identity.js";

export const grantProperties = {
  projectIds: { type: "array", maxItems: 200, items: { type: "string", minLength: 1, maxLength: 200 } },
  organizationIds: { type: "array", maxItems: 100, items: { type: "string", minLength: 1, maxLength: 200 } },
  packageScopes: { type: "array", maxItems: 100, items: { type: "string", pattern: "^(\\*|@[a-z0-9][a-z0-9._-]*)$" } },
};
const roleProperty = { type: "string", enum: ROLES };
const passwordProperty = { type: "string", minLength: 1, maxLength: 1024 };

export const setupBody = {
  type: "object",
  required: ["bootstrapToken", "username", "password"],
  additionalProperties: false,
  properties: {
    bootstrapToken: { type: "string", minLength: 1, maxLength: 1024 },
    username: { type: "string", maxLength: 200 },
    displayName: { type: "string", maxLength: 200 },
    password: passwordProperty,
  },
};

export const loginBody = {
  type: "object",
  required: ["username", "password"],
  additionalProperties: false,
  properties: { username: { type: "string", maxLength: 200 }, password: passwordProperty },
};

export const passwordBody = {
  type: "object",
  required: ["currentPassword", "newPassword"],
  additionalProperties: false,
  properties: { currentPassword: passwordProperty, newPassword: passwordProperty },
};

export const createUserBody = {
  type: "object",
  required: ["username", "password", "role"],
  additionalProperties: false,
  properties: {
    username: { type: "string", maxLength: 200 },
    displayName: { type: "string", maxLength: 200 },
    password: passwordProperty,
    role: roleProperty,
    ...grantProperties,
  },
};

export const updateUserBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    displayName: { type: "string", minLength: 1, maxLength: 200 },
    role: roleProperty,
    disabled: { type: "boolean" },
    password: passwordProperty,
    ...grantProperties,
  },
};
