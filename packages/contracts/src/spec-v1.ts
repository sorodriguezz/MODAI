// MODAI Package Specification v1 (apiVersion modai.dev/v1).
// The Core interprets these contracts generically: it never branches on a category,
// framework, methodology or agent product. See docs/spec/PACKAGE-SPEC-v1.md.
import { z } from "zod";
import { agentDefinitionSchema, packageNameSchema } from "./base-schemas.js";

export const API_VERSION = "modai.dev/v1" as const;

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const semverSchema = z.string().max(100).regex(semverPattern, "Debe ser una versión SemVer exacta");
export const rangeSchema = z.string().min(1).max(100);
/** Capability identifiers are dotted, lowercase and vendor-neutral: browser.automation, testing.regression.execute. */
export const capabilityIdSchema = z.string().max(128).regex(/^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/, "Usa un identificador con puntos, por ejemplo browser.automation");
export const categorySchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/, "category usa minúsculas y guiones");
const relativePathSchema = z.string().min(1).max(1024);
const contributionName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "Usa minúsculas, números y guiones (máx. 64)");

/** Permissions are explicit consent. MODAI enforces what it controls (writes, spawning, env forwarding); it is not a sandbox. */
export const PERMISSIONS_V1 = [
  "project.instructions", // write agent instruction files outside .modai/ and .agents/
  "project.files",        // install raw files under docs/
  "project.source",       // install source-code components into the project tree (src/, lib/, ...)
  "process.execute",      // run commands declared by the package
  "mcp.connect",          // start MCP servers declared by the package
  "filesystem.read",      // declared intent: the tool reads project files
  "filesystem.write",     // declared intent: the tool writes project files
  "network",              // declared intent: the tool uses the network
  "env.read",             // forward declared environment variables
] as const;
export const permissionV1Schema = z.enum(PERMISSIONS_V1);
export type PermissionV1 = (typeof PERMISSIONS_V1)[number];

/** Accepts "browser.automation", "browser.automation@^1.0.0" or { capability, version }. */
const capabilityRef = (defaultVersion: string, isRange: boolean) => z.preprocess(
  value => {
    if (typeof value !== "string") return value;
    const at = value.indexOf("@");
    return at < 0 ? { capability: value } : { capability: value.slice(0, at), version: value.slice(at + 1) };
  },
  z.object({ capability: capabilityIdSchema, version: (isRange ? rangeSchema : semverSchema).default(defaultVersion), description: z.string().max(1000).optional() }).strict(),
);
export const providedCapabilitySchema = capabilityRef("1.0.0", false);
export const requiredCapabilitySchema = capabilityRef("*", true);

const jsonSchemaObject = z.record(z.string(), z.unknown())
  .refine(value => value.type === "object" && JSON.stringify(value).length <= 32_000, "inputSchema debe ser un objeto JSON Schema de hasta 32 kB")
  .default({ type: "object", properties: {}, additionalProperties: false });
const commandSchema = z.string().min(1).max(1000);
const argsSchema = z.array(z.string().max(4000)).max(100).default([]);
const envKeysSchema = z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).max(30).default([]);

export const toolContributionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "Nombre de herramienta: minúsculas, números y _"),
  description: z.string().min(1).max(1000),
  inputSchema: jsonSchemaObject,
  /** `node` resolves to the Node runtime running MODAI. ${packageDir} and ${projectDir} are substituted in args. */
  command: commandSchema,
  args: argsSchema,
  envKeys: envKeysSchema,
  timeoutMs: z.number().int().min(100).max(600_000).default(60_000),
  readOnly: z.boolean().default(false),
  /** Optional capability this tool implements, so agents can discover it by contract instead of by package. */
  implements: capabilityIdSchema.optional(),
}).strict();

export const mcpServerContributionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  description: z.string().min(1).max(1000),
  command: commandSchema,
  args: argsSchema,
  envKeys: envKeysSchema,
}).strict();

export const componentContributionSchema = z.object({
  name: contributionName,
  description: z.string().max(1000).optional(),
  /** Directory inside the package whose files form the component ("." for the package root). */
  path: relativePathSchema,
  /** Project directory where the files are installed. Placeholders: {component}, {package}. */
  target: relativePathSchema,
  language: z.string().max(64).optional(),
  tags: z.array(z.string().max(64)).max(50).default([]),
}).strict();

export const contributesSchema = z.object({
  /** Agent Skills directories (each contains SKILL.md); activated on demand by compatible agents. */
  skills: z.array(z.object({ name: contributionName, path: relativePathSchema, files: z.array(relativePathSchema).max(500).optional() }).strict()).max(200).default([]),
  /** Short instruction fragments merged by adapters into the agent's instruction surface. */
  rules: z.array(z.object({ name: contributionName, path: relativePathSchema, description: z.string().max(1000).optional() }).strict()).max(200).default([]),
  /** Retrieved on demand by the Context Gateway; never loaded wholesale into a prompt. */
  knowledge: z.array(z.object({ path: relativePathSchema, title: z.string().min(1).max(300), tags: z.array(z.string().max(64)).max(50).default([]) }).strict()).max(1000).default([]),
  tools: z.array(toolContributionSchema).max(100).default([]),
  mcpServers: z.array(mcpServerContributionSchema).max(20).default([]),
  agents: z.array(agentDefinitionSchema.extend({ name: contributionName })).max(20).default([]),
  /**
   * Reusable source code (a backend module, a UI component, a service template...) copied into the
   * project tree. Every file under `path` lands under `target`; like any managed file, it is removed
   * on `modai remove` only while intact, so user edits are preserved.
   */
  components: z.array(componentContributionSchema).max(100).default([]),
  /** Escape hatch for raw files; targets are restricted to safe locations. */
  files: z.array(z.object({ source: relativePathSchema, target: relativePathSchema, executable: z.boolean().optional() }).strict()).max(2000).default([]),
}).strict();

const blockTarget = z.object({ mode: z.literal("block"), file: relativePathSchema }).strict();
const fileTarget = z.object({ mode: z.literal("file"), path: relativePathSchema, header: z.string().max(4000).optional() }).strict();
export const adapterDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  description: z.string().min(1).max(1000),
  targets: z.object({
    /** Directory template; placeholders: {skill}, {package}. */
    skills: z.object({ path: relativePathSchema }).strict().optional(),
    /** Rules as a managed block in a file, or one file per rule ({package}, {rule}). */
    rules: z.union([blockTarget, fileTarget]).optional(),
    /** Managed block summarising installed skills, rules, tools and knowledge. */
    index: blockTarget.optional(),
    /** JSON file where the MODAI gateway is registered. `pointer` is a dotted path; `value` is a JSON template. */
    mcp: z.object({ file: relativePathSchema, pointer: z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/).default("mcpServers.modai"), value: z.unknown().optional() }).strict().optional(),
  }).strict(),
}).strict();

export const packageManifestV1Schema = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.enum(["Package", "Profile", "Adapter"]).default("Package"),
  metadata: z.object({
    name: packageNameSchema,
    version: semverSchema,
    description: z.string().min(1).max(5000),
    license: z.string().max(100).optional(),
    authors: z.array(z.string().max(200)).max(50).optional(),
    homepage: z.string().url().max(1000).optional(),
    keywords: z.array(z.string().max(64)).max(50).optional(),
  }).strict(),
  spec: z.object({
    /** Informative only. The Core never changes behaviour based on category. */
    category: categorySchema.default("general"),
    dependencies: z.record(packageNameSchema, rangeSchema).refine(value => Object.keys(value).length <= 100, "Máximo 100 dependencias").default({}),
    provides: z.array(providedCapabilitySchema).max(100).default([]),
    requires: z.array(requiredCapabilitySchema).max(100).default([]),
    optional: z.array(requiredCapabilitySchema).max(100).default([]),
    conflicts: z.array(z.union([z.object({ package: packageNameSchema }).strict(), z.object({ capability: capabilityIdSchema }).strict()])).max(100).default([]),
    permissions: z.array(permissionV1Schema).max(PERMISSIONS_V1.length).default([]),
    contributes: contributesSchema.default({ skills: [], rules: [], knowledge: [], tools: [], mcpServers: [], agents: [], components: [], files: [] }),
    /** Extra files shipped in the artifact (for example tool scripts). Directories are included recursively. */
    include: z.array(relativePathSchema).max(500).default([]),
    /** Packaging-time shorthand, expanded into `contributes` by the CLI before publishing. */
    entrypoints: z.object({ skills: relativePathSchema.optional(), knowledge: relativePathSchema.optional(), rules: relativePathSchema.optional() }).strict().optional(),
    adapter: adapterDefinitionSchema.optional(),
    compatibility: z.object({
      modai: rangeSchema.optional(),
      os: z.array(z.enum(["linux", "darwin", "win32"])).max(3).optional(),
    }).strict().default({}),
  }).strict(),
}).strict().superRefine((manifest, ctx) => {
  if (manifest.kind === "Adapter" && !manifest.spec.adapter) ctx.addIssue({ code: "custom", path: ["spec", "adapter"], message: "Un paquete Adapter necesita spec.adapter" });
  if (manifest.kind !== "Adapter" && manifest.spec.adapter) ctx.addIssue({ code: "custom", path: ["spec", "adapter"], message: "spec.adapter solo se admite con kind: Adapter" });
});

export type PackageManifestV1 = z.output<typeof packageManifestV1Schema>;
export type PackageManifestV1Input = z.input<typeof packageManifestV1Schema>;
export type ProvidedCapability = { capability: string; version: string; description?: string };
export type RequiredCapability = { capability: string; version: string; description?: string };
export type ToolContribution = z.output<typeof toolContributionSchema>;
export type McpServerContribution = z.output<typeof mcpServerContributionSchema>;
export type Contributions = z.output<typeof contributesSchema>;
export type ComponentContribution = z.output<typeof componentContributionSchema>;
export type AdapterDefinition = z.output<typeof adapterDefinitionSchema>;

// ---------------------------------------------------------------------------
// Project files: modai.yaml and modai.lock
// ---------------------------------------------------------------------------

export const registrySourceSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  url: z.string().url().max(1000).optional(),
  path: z.string().min(1).max(4096).optional(),
}).strict().refine(value => Boolean(value.url) !== Boolean(value.path), "Cada registry necesita url o path, no ambos");

export const projectFileSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal("Project"),
  name: z.string().min(1).max(200),
  registries: z.array(registrySourceSchema).max(20).default([]),
  /** Direct dependencies: "@scope/name": "^1.0.0" or "file:../path". */
  dependencies: z.record(packageNameSchema, z.string().min(1).max(4096)).default({}),
  overrides: z.record(packageNameSchema, rangeSchema).default({}),
  /** Explicit provider choice when several installed packages provide a capability. */
  providers: z.record(capabilityIdSchema, packageNameSchema).default({}),
  adapters: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(20).default(["agent-skills", "mcp"]),
  signaturePolicy: z.enum(["optional", "signed", "trusted"]).optional(),
  context: z.object({
    memory: z.enum(["local", "remote", "off"]).default("local"),
    server: z.string().url().max(1000).optional(),
    projectId: z.string().min(1).max(200).optional(),
  }).strict().default({ memory: "local" }),
}).strict();
export type ProjectFile = z.output<typeof projectFileSchema>;
export type RegistrySource = z.output<typeof registrySourceSchema>;

/** `userSha256`: the user chose to keep their version (--keep-mine); MODAI's content is `sha256`. */
const managedFile = z.object({ type: z.literal("file"), path: z.string(), sha256: z.string(), owner: z.string(), adapter: z.string().optional(), userSha256: z.string().optional() }).strict();
const managedBlock = z.object({ type: z.literal("block"), path: z.string(), id: z.string(), sha256: z.string(), owners: z.array(z.string()), adapter: z.string().optional() }).strict();
const managedJson = z.object({ type: z.literal("json"), path: z.string(), pointer: z.string(), sha256: z.string(), adapter: z.string().optional() }).strict();
export const managedEntrySchema = z.discriminatedUnion("type", [managedFile, managedBlock, managedJson]);
export type ManagedEntry = z.output<typeof managedEntrySchema>;

export const lockedPackageSchema = z.object({
  version: z.string(),
  source: z.string(),
  integrity: z.string().regex(/^sha256-[a-f0-9]{64}$/),
  signer: z.string().optional(),
  kind: z.enum(["Package", "Profile", "Adapter"]),
  category: z.string(),
  dependencies: z.record(z.string(), z.string()).default({}),
  provides: z.array(z.string()).default([]),
  requires: z.record(z.string(), z.string()).default({}),
  permissions: z.array(z.string()).default([]),
}).strict();
export type LockedPackageV1 = z.output<typeof lockedPackageSchema>;

export const lockFileSchema = z.object({
  lockfileVersion: z.literal(1),
  packages: z.record(z.string(), lockedPackageSchema).default({}),
  capabilities: z.record(z.string(), z.object({ provider: z.string(), version: z.string() }).strict()).default({}),
  managed: z.array(managedEntrySchema).default([]),
}).strict();
export type LockFile = z.output<typeof lockFileSchema>;
