import type { Command } from "commander";
import { loadActivation } from "../../agents/activation.js";
import { verifyBundle } from "../../agents/bundle.js";
import { executeAgent } from "../../agents/runtime.js";
import { type ExecutionFlags, runtimeOptions } from "../../agents/runtime-options.js";
import { agentSpec } from "../../services/package-spec.js";
import { serverClient, serverProject } from "../../services/server-project.js";
import { installationPolicy } from "../../services/trust.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

export function withExecutionOptions(command: Command): Command {
  return command
    .option("--model <model>", "Modelo local de Ollama")
    .option("--url <url>", "Ollama en loopback")
    .option("--max-steps <number>", "Máximo de pasos, de 1 a 32")
    .option("--allow-mcp <names>", "Procesos MCP autorizados", commaList)
    .option("--allow-env <names>", "Variables que pueden recibir esos procesos", commaList);
}

export function registerAgentRun(agent: Command, print: Print): void {
  withExecutionOptions(
    agent.command("run").argument("<task>").description("Ejecuta el agente activo con un modelo local"),
  ).action(async (task: string, options: ExecutionFlags) => {
    const target = serverProject(),
      activation = loadActivation(target.root),
      api = serverClient(target);
    await verifyBundle(api, activation.bundle, await installationPolicy(api, target));
    print(
      await executeAgent(api, activation.bundle, task, { ...runtimeOptions(options, activation), cwd: target.root }),
    );
  });
}

export function registerAgentSubmit(agent: Command, print: Print): void {
  agent
    .command("submit")
    .argument("<task>")
    .description("Encola la tarea para que la procese un worker")
    .option("--agent <package>", "Agente; por defecto el activo")
    .option("--idempotency-key <key>")
    .action(async (task: string, options: { agent?: string; idempotencyKey?: string }) => {
      const target = serverProject();
      const active = options.agent ? undefined : loadActivation(target.root).bundle.agent;
      const item = active ? { name: active.name, range: active.version } : agentSpec(options.agent!);
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
}

export function registerAgentRuns(agent: Command, print: Print): void {
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
    .action(async (id: string) => print(await serverClient(serverProject()).run(id)));
  runs
    .command("cancel")
    .description("Cancela una ejecución en cola o en curso")
    .argument("<id>")
    .action(async (id: string) => print(await serverClient(serverProject()).cancelRun(id)));
}
