import { setTimeout as delay } from "node:timers/promises";
import { signaturePolicySchema } from "@modai/contracts/schemas";
import { type PermissionV1, permissionV1Schema } from "@modai/contracts/spec-v1";
import type { Activation, SignaturePolicy } from "@modai/contracts/types";
import { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import { activateAgent, deactivateAgent, loadActivation, verifyBundle } from "../agent/activation.js";
import { serverClient, serverProject } from "../agent/project.js";
import { executeAgent, type RuntimeOptions } from "../agent/runtime.js";
import { installationPolicy } from "../agent/trust.js";
import { workOnce } from "../agent/worker.js";
import { loadClientConfig } from "./config.js";
import { effectiveConnection } from "./connection.js";
import type { Print } from "./output.js";

export const commaList = (value: string, previous: string[] = []) => [
  ...previous,
  ...value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
];
function packageSpec(spec: string) {
  const i = spec.lastIndexOf("@");
  return i > spec.indexOf("/") ? { name: spec.slice(0, i), range: spec.slice(i + 1) } : { name: spec, range: "*" };
}
interface Options {
  model?: string;
  url?: string;
  maxSteps?: string;
  allowMcp?: string[];
  allowEnv?: string[];
}

export function runtimeOptions(options: Options, activation?: Activation): RuntimeOptions {
  const maxSteps = options.maxSteps === undefined ? undefined : Number(options.maxSteps);
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 32))
    throw new Error("max-steps debe estar entre 1 y 32");
  return {
    cwd: process.cwd(),
    model: options.model,
    url: options.url,
    maxSteps,
    allowedMcp: options.allowMcp ?? activation?.allowedMcp ?? [],
    allowedEnv: options.allowEnv ?? activation?.allowedEnv ?? [],
  };
}

function executionOptions(command: Command): Command {
  return command
    .option("--model <model>", "Modelo local de Ollama")
    .option("--url <url>", "Ollama en loopback")
    .option("--max-steps <number>", "Máximo de pasos, de 1 a 32")
    .option("--allow-mcp <names>", "Procesos MCP autorizados", commaList)
    .option("--allow-env <names>", "Variables que pueden recibir esos procesos", commaList);
}

/** Agents, remote runs and workers. They work on a v1 project linked to a server project (modai init --project). */
export function registerAgentCommands(program: Command, print: Print) {
  const agent = program
    .command("agent")
    .description("Agentes versionados del servidor: componer, activar, ejecutar, encolar tareas y procesarlas");
  agent
    .command("list")
    .description("Agentes publicados en el servidor")
    .action(async () => {
      const connection = effectiveConnection();
      print(
        (await new ApiClient(connection.server, connection.token).agents()).map((item) => ({
          agent: item.name,
          version: item.version,
          description: item.description,
        })),
      );
    });
  agent
    .command("compose")
    .argument("<package>")
    .description("Muestra qué paquetes, instrucciones y capacidades tendría el agente")
    .action(async (spec: string) => {
      const target = serverProject(),
        item = packageSpec(spec);
      print(await serverClient(target).composeAgent(target.projectId, item.name, item.range, target.overrides));
    });
  agent
    .command("activate")
    .argument("<package>")
    .description("Instala el agente en el proyecto y deja sus instrucciones en .modai/agent.md")
    .option("--adapter <adapter>", "files, agents-md o claude-md", "files")
    .option("--allow <permissions>", "Permisos de instalación autorizados", commaList)
    .option("--allow-mcp <names>", "Procesos MCP autorizados", commaList)
    .option("--allow-env <names>", "Variables autorizadas", commaList)
    .action(async (spec: string, options) => {
      if (!["files", "agents-md", "claude-md"].includes(options.adapter))
        throw new Error("Adaptador inválido: usa files, agents-md o claude-md");
      const target = serverProject(),
        item = packageSpec(spec);
      const activation = await activateAgent(serverClient(target), target.root, target.server, item.name, item.range, {
        adapter: options.adapter,
        grants: (options.allow ?? []).map((value: string) => permissionV1Schema.parse(value)) as PermissionV1[],
        allowedMcp: options.allowMcp,
        allowedEnv: options.allowEnv,
      });
      print({
        agent: `${activation.bundle.agent.name}@${activation.bundle.agent.version}`,
        adapter: activation.adapter,
        instructions: ".modai/agent.md",
        tools: activation.bundle.capabilities.map((capability) => capability.name),
        next: 'Tu cliente MCP verá el agente en el servidor modai del proyecto (modai-mcp), o ejecútalo con: modai agent run "<tarea>"',
      });
    });
  agent
    .command("deactivate")
    .description("Desactiva el agente conservando archivos modificados")
    .action(() => print(deactivateAgent(serverProject().root)));
  executionOptions(
    agent.command("run").argument("<task>").description("Ejecuta el agente activo con un modelo local"),
  ).action(async (task: string, options) => {
    const target = serverProject(),
      activation = loadActivation(target.root),
      api = serverClient(target);
    await verifyBundle(api, activation.bundle, await installationPolicy(api, target));
    print(
      await executeAgent(api, activation.bundle, task, { ...runtimeOptions(options, activation), cwd: target.root }),
    );
  });
  agent
    .command("submit")
    .argument("<task>")
    .description("Encola la tarea para que la procese un worker")
    .option("--agent <package>", "Agente; por defecto el activo")
    .option("--idempotency-key <key>")
    .action(async (task: string, options: { agent?: string; idempotencyKey?: string }) => {
      const target = serverProject();
      const item = options.agent
        ? packageSpec(options.agent)
        : (() => {
            const active = loadActivation(target.root);
            return { name: active.bundle.agent.name, range: active.bundle.agent.version };
          })();
      print(
        await serverClient(target).submitRun({
          projectId: target.projectId,
          ...item,
          task,
          overrides: target.overrides,
          idempotencyKey: options.idempotencyKey,
        }),
      );
    });

  const runs = agent.command("runs").description("Consulta y cancela ejecuciones remotas del proyecto");
  runs
    .command("list", { isDefault: true })
    .description("Últimas ejecuciones del proyecto")
    .action(async () => {
      const target = serverProject();
      print(
        (await serverClient(target).runs(target.projectId)).map((run) => ({
          id: run.id,
          agent: `${run.agentName}@${run.agentVersion}`,
          status: run.status,
          created: run.createdAt,
        })),
      );
    });
  runs
    .command("show")
    .description("Detalle y resultado de una ejecución")
    .argument("<id>")
    .action(async (id: string) => {
      const target = serverProject();
      print(await serverClient(target).run(id));
    });
  runs
    .command("cancel")
    .description("Cancela una ejecución en cola o en curso")
    .argument("<id>")
    .action(async (id: string) => {
      const target = serverProject();
      print(await serverClient(target).cancelRun(id));
    });

  executionOptions(
    agent.command("worker").description("Procesa en este equipo las tareas encoladas de un proyecto del servidor"),
  )
    .requiredOption("--project <id>")
    .option("--once", "Procesa una tarea y termina")
    .option("--signature-policy <policy>", "optional, signed o trusted", "trusted")
    .action(async (options) => {
      const connection = effectiveConnection();
      const api = new ApiClient(connection.server, connection.token);
      await api.assertCompatible();
      const config = loadClientConfig(),
        requested = signaturePolicySchema.parse(options.signaturePolicy);
      const order: SignaturePolicy[] = ["optional", "signed", "trusted"],
        info = await api.health();
      const policy =
        order[
          Math.max(
            order.indexOf(requested),
            order.indexOf(config?.signaturePolicy ?? "optional"),
            order.indexOf(info.signaturePolicy),
          )
        ];
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        do {
          const worked = await workOnce(api, options.project, {
            ...runtimeOptions(options),
            signal: controller.signal,
            signaturePolicy: policy,
            trustedPublishers: config?.trustedPublishers ?? [],
          });
          if (options.once) {
            print({ processed: worked });
            break;
          }
          if (!worked) await delay(2000, undefined, { signal: controller.signal });
        } while (!controller.signal.aborted);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    });
}
