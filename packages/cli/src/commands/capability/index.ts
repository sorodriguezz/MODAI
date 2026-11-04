import { inspectWorkspace, loadGrants, loadV1Project, runTool, suggestProviders } from "@modai/core";
import type { Command } from "commander";
import { requireProject } from "../../services/project.js";
import { projectRegistry } from "../../services/registries.js";
import { runSync } from "../../services/sync.js";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";
import { capabilityReport, toolRows } from "./report.js";

async function runInstalledTool(name: string, input: string) {
  const root = requireProject(),
    project = loadV1Project(root),
    grants = loadGrants(root);
  const owner = inspectWorkspace(project).find((item) =>
    item.manifest.spec.contributes.tools.some((tool) => tool.name === name),
  );
  if (!owner) throw new Error(`Herramienta no instalada: ${name}`);
  if (!owner.verified) throw new Error(`${owner.name} no supera la verificación de integridad; ejecuta modai sync`);
  if (!owner.authorization.allowed) throw new Error(`${owner.name}: ${owner.authorization.reason}`);
  return runTool(owner.manifest.spec.contributes.tools.find((tool) => tool.name === name)!, JSON.parse(input), {
    packageDir: owner.packageDir,
    projectDir: root,
    grant: grants.packages[owner.name],
  });
}

function registerCapabilityTools(capability: Command, print: Print): void {
  capability
    .command("tools")
    .description("Herramientas ejecutables aportadas por los paquetes instalados")
    .action(() => print(toolRows(inspectWorkspace(loadV1Project(requireProject())))));
  capability
    .command("run")
    .description("Ejecuta una herramienta autorizada de un paquete")
    .argument("<tool>")
    .option("--input <json>", "Entrada JSON", "{}")
    .action(async (name: string, options: { input: string }) => print(await runInstalledTool(name, options.input)));
}

function registerCapabilityProviders(capability: Command, print: Print): void {
  capability
    .command("providers")
    .description("Busca en los registries paquetes que proporcionan una capacidad")
    .argument("<capability>")
    .action(async (name: string) => {
      print(await suggestProviders(projectRegistry(loadV1Project(requireProject())), name));
    });
  capability
    .command("use")
    .description("Fija el proveedor de una capacidad cuando hay varios instalados")
    .argument("<capability>")
    .argument("<package>")
    .action(async (name: string, provider: string) => {
      const { report } = await runSync(requireProject(), (file) => {
        file.providers[name] = provider;
      });
      print(`${name} → ${provider}\n${summarize(report)}`);
    });
}

export function registerCapabilityCommands(program: Command, print: Print): void {
  const capability = group(
    program,
    "capability",
    "Capacidades del proyecto: contratos, proveedores y herramientas ejecutables",
  );
  capability
    .command("list", { isDefault: true })
    .description("Contratos provistos y requeridos, herramientas, servidores MCP y skills del proyecto")
    .action(() => print(capabilityReport(requireProject())));
  registerCapabilityTools(capability, print);
  registerCapabilityProviders(capability, print);
}
