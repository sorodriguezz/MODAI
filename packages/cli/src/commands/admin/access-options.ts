import type { AccessGrants } from "@modai/sdk";
import type { Command } from "commander";
import { commaList } from "../../terminal/options.js";

export interface AccessOptions {
  organizations?: string[];
  projects?: string[];
  scopes?: string[];
}

interface AccessHelp {
  organizations: string;
  projects: string;
  scopes: string;
}

const DEFAULT_HELP: AccessHelp = { organizations: "Organizaciones", projects: "Proyectos", scopes: "Namespaces" };

export const withAccessOptions = (command: Command, help: AccessHelp = DEFAULT_HELP): Command =>
  command
    .option("--organizations <ids>", help.organizations, commaList)
    .option("--projects <ids>", help.projects, commaList)
    .option("--scopes <namespaces>", help.scopes, commaList);

export const accessGrants = ({ organizations, projects, scopes }: AccessOptions): Partial<AccessGrants> => ({
  organizationIds: organizations,
  projectIds: projects,
  packageScopes: scopes,
});

export const replacementGrants = ({ organizations = [], projects = [], scopes = [] }: AccessOptions): AccessGrants => ({
  organizationIds: organizations,
  projectIds: projects,
  packageScopes: scopes,
});
