import { AppError } from "@modai/contracts/errors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppOptions } from "./config.js";
import { type Database, openDatabase } from "./infrastructure/database/database.js";
import { resolveDatabaseConfig } from "./infrastructure/database/database-url.js";
import { registerAdminAssets } from "./infrastructure/http/admin-assets.js";
import { registerErrorHandler } from "./infrastructure/http/error-handler.js";
import { registerIdentityHooks } from "./infrastructure/http/identity-hooks.js";
import { parsePublicUrl, registerSecurity } from "./infrastructure/http/security.js";
import { adminRoutes } from "./modules/admin/admin.routes.js";
import { systemRoutes } from "./modules/admin/system.routes.js";
import { agentsRoutes } from "./modules/agents/agents.routes.js";
import { apiKeysRoutes } from "./modules/auth/api-keys.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { seedInitialAdmin } from "./modules/auth/seed-admin.js";
import { usersRoutes } from "./modules/auth/users.routes.js";
import { categoriesRoutes } from "./modules/categories/categories.routes.js";
import { knowledgeRoutes } from "./modules/knowledge/knowledge.routes.js";
import { memoryRoutes } from "./modules/memory/memory.routes.js";
import type { ModuleOptions } from "./modules/module-options.js";
import { namespacesRoutes } from "./modules/namespaces/namespaces.routes.js";
import { organizationsRoutes } from "./modules/organizations/organizations.routes.js";
import { packageFilesRoutes } from "./modules/packages/package-files.routes.js";
import { packageImportsRoutes } from "./modules/packages/package-imports.routes.js";
import { packagesRoutes } from "./modules/packages/packages.routes.js";
import { packagesAdminRoutes } from "./modules/packages/packages-admin.routes.js";
import { usageRoutes } from "./modules/packages/usage.routes.js";
import { projectsRoutes } from "./modules/projects/projects.routes.js";
import { runsRoutes } from "./modules/runs/runs.routes.js";
import { createServices, type Services } from "./modules/services.js";

export type { AppOptions } from "./config.js";

const MODULES = [
  systemRoutes,
  authRoutes,
  usersRoutes,
  apiKeysRoutes,
  organizationsRoutes,
  namespacesRoutes,
  projectsRoutes,
  packagesRoutes,
  packageImportsRoutes,
  packageFilesRoutes,
  packagesAdminRoutes,
  usageRoutes,
  categoriesRoutes,
  knowledgeRoutes,
  memoryRoutes,
  agentsRoutes,
  runsRoutes,
  adminRoutes,
];

async function prepareServices(database: Database, options: AppOptions): Promise<Services> {
  const services = createServices(database, {
    ...options,
    signaturePolicy: options.signaturePolicy ?? "optional",
  });
  await seedInitialAdmin(services.users, services.audit, options.initialAdmin);
  if (!(await services.apiKeys.configured()))
    throw new AppError(
      500,
      "AUTH_NOT_CONFIGURED",
      "Configura MODAI_API_TOKEN, MODAI_ADMIN_USERNAME/MODAI_ADMIN_PASSWORD o una API key admin activa antes de arrancar",
    );
  return services;
}

async function registerInfrastructure(
  app: FastifyInstance,
  services: Services,
  options: AppOptions,
  publicUrl?: string,
) {
  await registerSecurity(app, { rateLimitMax: options.rateLimitMax });
  registerIdentityHooks(app, {
    bearer: (token) => services.apiKeys.authenticate(token),
    session: (token) => services.sessions.authenticate(token),
    publicUrl,
  });
  app.addHook("onResponse", async (request, reply) => {
    services.metrics.observe(request.method, request.routeOptions.url ?? request.url, reply.statusCode);
  });
  registerErrorHandler(app);
  if (options.adminDirectory !== false) registerAdminAssets(app, options.adminDirectory);
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const publicUrl = parsePublicUrl(options.publicUrl);
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1024 * 1024,
    trustProxy: (options.trustProxy ?? false) as boolean,
  });
  const database = await openDatabase(resolveDatabaseConfig(options));
  let services: Services;
  try {
    services = await prepareServices(database, options);
    await registerInfrastructure(app, services, options, publicUrl);
  } catch (error) {
    await database.close();
    throw error;
  }
  const moduleOptions: ModuleOptions = {
    services,
    config: {
      publicUrl,
      signaturePolicy: options.signaturePolicy ?? "optional",
      loginRateLimitMax: options.loginRateLimitMax,
      loginDelayMs: options.loginDelayMs,
    },
  };
  for (const module of MODULES) await app.register(module, moduleOptions);
  app.addHook("onClose", async () => database.close());
  return app;
}
