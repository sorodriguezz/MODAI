import type { FastifyInstance } from "fastify";
import { identityOf } from "../../infrastructure/http/identity-hooks.js";
import type { ModuleOptions } from "../module-options.js";

export async function systemRoutes(app: FastifyInstance, { services, config }: ModuleOptions): Promise<void> {
  const { authz, metrics } = services;
  app.get("/health", async (request) => ({
    status: "ok",
    service: "modularai",
    version: "0.12.0",
    apiVersion: 1,
    signaturePolicy: config.signaturePolicy,
    publicUrl: config.publicUrl,
    ...(identityOf(request) ? { runtime: process.version } : {}),
  }));
  app.get("/", async (_request, reply) => reply.redirect("/admin"));
  app.get("/api/v1", async (request) => {
    authz.require(identityOf(request), "reader");
    return {
      name: "ModularAI API",
      version: "v1",
      resources: ["packages", "resolve", "artifacts", "knowledge", "memories", "admin", "metrics"],
      architecture: {
        server: "registry-context-and-agent-control",
        inference: "client-or-worker",
        embeddings: "client-generated",
      },
    };
  });
  app.get("/metrics", async (request, reply) => {
    authz.require(identityOf(request), "reader");
    return reply.type("text/plain; version=0.0.4").send(metrics.prometheus());
  });
}
