import { strictObject } from "../../infrastructure/http/json-schema.js";
import { ROLES } from "./identity.js";

const idList = (maxItems: number) => ({
  type: "array",
  maxItems,
  items: { type: "string", minLength: 1, maxLength: 200 },
});

export const grantProperties = {
  projectIds: idList(200),
  organizationIds: idList(100),
  packageScopes: { type: "array", maxItems: 100, items: { type: "string", pattern: "^(\\*|@[a-z0-9][a-z0-9._-]*)$" } },
};
const roleProperty = { type: "string", enum: ROLES };
const passwordProperty = { type: "string", minLength: 1, maxLength: 1024 };
const factorProperty = { type: "string", minLength: 1, maxLength: 80 };
const usernameProperty = { type: "string", maxLength: 200 };

export const setupBody = strictObject(
  {
    bootstrapToken: { type: "string", minLength: 1, maxLength: 1024 },
    username: usernameProperty,
    displayName: { type: "string", maxLength: 200 },
    password: passwordProperty,
  },
  ["bootstrapToken", "username", "password"],
);

export const loginBody = strictObject(
  { username: usernameProperty, password: passwordProperty, code: factorProperty },
  ["username", "password"],
);

export const mfaSetupBody = strictObject({ currentPassword: passwordProperty }, ["currentPassword"]);

export const mfaConfirmBody = strictObject(
  { setupToken: { type: "string", minLength: 1, maxLength: 120 }, code: factorProperty },
  ["setupToken", "code"],
);

export const mfaChangeBody = strictObject({ currentPassword: passwordProperty, code: factorProperty }, [
  "currentPassword",
  "code",
]);

export const passwordBody = strictObject({ currentPassword: passwordProperty, newPassword: passwordProperty }, [
  "currentPassword",
  "newPassword",
]);

export const createUserBody = strictObject(
  {
    username: usernameProperty,
    displayName: { type: "string", maxLength: 200 },
    password: passwordProperty,
    role: roleProperty,
    ...grantProperties,
  },
  ["username", "password", "role"],
);

export const updateUserBody = strictObject({
  displayName: { type: "string", minLength: 1, maxLength: 200 },
  role: roleProperty,
  disabled: { type: "boolean" },
  password: passwordProperty,
  ...grantProperties,
});
