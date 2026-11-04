import type { Command } from "commander";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";
import { registerAdminExport, registerAdminImport } from "./backup.js";
import { registerAdminCreateKey, registerAdminGrantKey, registerAdminKeys, registerAdminRevokeKey } from "./keys.js";
import { registerAdminAudit, registerAdminPrune } from "./maintenance.js";
import {
  registerAdminCreateNamespace,
  registerAdminDeleteNamespace,
  registerAdminNamespaces,
  registerAdminUpdateNamespace,
} from "./namespaces.js";
import {
  registerAdminCreateOrganization,
  registerAdminDeleteOrganization,
  registerAdminOrganizations,
  registerAdminUpdateOrganization,
} from "./organizations.js";
import { registerAdminPublishers, registerAdminTrustPublisher, registerAdminUntrustPublisher } from "./publishers.js";
import {
  registerAdminCreateUser,
  registerAdminDeleteUser,
  registerAdminUpdateUser,
  registerAdminUsers,
} from "./users.js";

const ORDER = [
  registerAdminExport,
  registerAdminImport,
  registerAdminCreateKey,
  registerAdminGrantKey,
  registerAdminCreateOrganization,
  registerAdminOrganizations,
  registerAdminNamespaces,
  registerAdminCreateNamespace,
  registerAdminTrustPublisher,
  registerAdminPublishers,
  registerAdminUntrustPublisher,
  registerAdminPrune,
  registerAdminUsers,
  registerAdminCreateUser,
  registerAdminUpdateUser,
  registerAdminDeleteUser,
  registerAdminKeys,
  registerAdminRevokeKey,
  registerAdminUpdateOrganization,
  registerAdminDeleteOrganization,
  registerAdminUpdateNamespace,
  registerAdminDeleteNamespace,
  registerAdminAudit,
];

export function registerAdminCommands(program: Command, print: Print): void {
  const admin = group(program, "admin", "Administración del servidor");
  for (const register of ORDER) register(admin, print);
}
