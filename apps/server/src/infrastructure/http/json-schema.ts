import { invariant } from "@modai/contracts/errors";

export type JsonSchema = Record<string, unknown>;

export function strictObject(properties: Record<string, JsonSchema>, required: readonly string[] = []): JsonSchema {
  return {
    type: "object",
    ...(required.length ? { required: [...required] } : {}),
    additionalProperties: false,
    properties,
  };
}

export const confirmationBody = strictObject({ confirmation: { type: "string", maxLength: 200 } }, ["confirmation"]);

export function requireConfirmation(confirmation: string, expected: string, message: string): void {
  invariant(confirmation === expected, 400, "CONFIRMATION_REQUIRED", message);
}
