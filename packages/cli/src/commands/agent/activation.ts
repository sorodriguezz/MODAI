import { type PermissionV1, permissionV1Schema } from "@modai/contracts/manifest";
import type { Activation } from "@modai/contracts/types";
import type { Command } from "commander";
import { activateAgent, deactivateAgent } from "../../agents/activation.js";
import { serverApi } from "../../services/connection.js";
import { agentSpec } from "../../services/package-spec.js";
import { serverClient, serverProject } from "../../services/server-project.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

type ActivateFlags = { adapter: string; allow?: string[]; allowMcp?: string[]; allowEnv?: string[] };

export function registerAgentList(agent: Command, print: Print): void {
  agent
    .command("list")
    .description("Agentes publicados en el servidor")
    .action(async () => {
      print(
        (await serverApi().agents()).map((item) => ({
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
        item = agentSpec(spec);
      print(await serverClient(target).composeAgent(target.projectId, item.name, item.range, target.overrides));
    });
}

export function registerAgentActivate(agent: Command, print: Print): void {
  agent
    .command("activate")
    .argument("<package>")
    .description("Instala el agente en el proyecto y deja sus instrucciones en .modai/agent.md")
    .option("--adapter <adapter>", "files, agents-md o claude-md", "files")
    .option("--allow <permissions>", "Permisos de instalación autorizados", commaList)
    .option("--allow-mcp <names>", "Procesos MCP autorizados", commaList)
    .option("--allow-env <names>", "Variables autorizadas", commaList)
    .action(async (spec: string, options: ActivateFlags) => {
      if (!["files", "agents-md", "claude-md"].includes(options.adapter))
        throw new Error("Adaptador inválido: usa files, agents-md o claude-md");
      const target = serverProject(),
        item = agentSpec(spec);
      const activation = await activateAgent(serverClient(target), target.root, target.server, item.name, item.range, {
        adapter: options.adapter as Activation["adapter"],
        grants: (options.allow ?? []).map((value) => permissionV1Schema.parse(value)) as PermissionV1[],
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
}
