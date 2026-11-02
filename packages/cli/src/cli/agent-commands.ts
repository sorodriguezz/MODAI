import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Command } from "commander";
import { ApiClient } from "@modai/sdk";
import type { Activation, Permission, RunnerBinding, SignaturePolicy } from "@modai/contracts/types";
import { permissionSchema, signaturePolicySchema } from "@modai/contracts/schemas";
import { activateAgent, deactivateAgent, loadActivation, verifyBundle } from "../agent/activation.js";
import { executeAgent, type RuntimeOptions } from "../agent/runtime.js";
import { workOnce } from "../agent/worker.js";
import { installationPolicy } from "./installer.js";
import { loadClientConfig, loadProject, readYaml } from "./config.js";
import { isV1Project } from "@modai/core/project";
import { capabilitiesV1 } from "../v1/commands.js";

export const commaList = (value: string, previous: string[] = []) => [...previous, ...value.split(",").map(item => item.trim()).filter(Boolean)];
function packageSpec(spec: string) { const i = spec.lastIndexOf("@"); return i > spec.indexOf("/") ? { name: spec.slice(0,i), range: spec.slice(i+1) } : { name: spec, range: "*" }; }
interface Options { model?: string; url?: string; maxSteps?: string; bindings?: string; allowTool?: string[]; allowMcp?: string[]; allowEnv?: string[] }
export function runtimeOptions(options: Options, activation?: Activation): RuntimeOptions {
  let bindings: Record<string, RunnerBinding> = {};
  if (options.bindings) {
    bindings = readYaml<Record<string, RunnerBinding>>(resolve(options.bindings));
    for (const [name, binding] of Object.entries(bindings)) {
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name) || !binding || typeof binding.command !== "string" || !Array.isArray(binding.args) || !binding.args.every(arg => typeof arg === "string") || (binding.envKeys && (!Array.isArray(binding.envKeys) || !binding.envKeys.every(key => typeof key === "string")))) throw new Error("Archivo de bindings inválido");
    }
  }
  const maxSteps = options.maxSteps === undefined ? undefined : Number(options.maxSteps);
  if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 32)) throw new Error("max-steps debe estar entre 1 y 32");
  return { cwd: process.cwd(), model: options.model, url: options.url, maxSteps, bindings,
    allowedTools: options.allowTool ?? activation?.allowedTools ?? [], allowedMcp: options.allowMcp ?? activation?.allowedMcp ?? [], allowedEnv: options.allowEnv ?? activation?.allowedEnv ?? [] };
}
function executionOptions(command: Command): Command {
  return command.option("--model <model>", "Modelo local de Ollama").option("--url <url>", "Ollama en loopback")
    .option("--max-steps <number>", "Máximo de pasos, de 1 a 32").option("--bindings <file>", "Mapa YAML de ejecutores locales")
    .option("--allow-tool <names>", "Herramientas locales autorizadas", commaList).option("--allow-mcp <names>", "Procesos MCP autorizados", commaList)
    .option("--allow-env <names>", "Variables que pueden recibir esos procesos", commaList);
}
export function registerAgentCommands(program: Command, connect: () => { server: string; token?: string }, print: (value: unknown) => void) {
  const client = () => { const c = connect(); return new ApiClient(c.server,c.token); };
  const agent = program.command("agent").description("Compone, activa y ejecuta agentes versionados");
  agent.command("deactivate").description("Desactiva el agente conservando archivos modificados").action(()=>print(deactivateAgent(process.cwd())));
  agent.command("list").action(async () => print(await client().agents()));
  agent.command("compose").argument("<package>").action(async spec => { const p = loadProject(), item = packageSpec(spec); print(await client().composeAgent(p.manifest.projectId,item.name,item.range,p.manifest.overrides)); });
  agent.command("activate").argument("<package>")
    .option("--adapter <adapter>", "files, agents-md o claude-md", "files")
    .option("--allow <permissions>", "Permisos de instalación autorizados", commaList)
    .option("--allow-tool <names>", "Herramientas locales autorizadas", commaList).option("--allow-mcp <names>", "Procesos MCP autorizados", commaList).option("--allow-env <names>", "Variables autorizadas", commaList)
    .action(async (spec, options) => {
      if (!["files","agents-md","claude-md"].includes(options.adapter)) throw new Error("Adaptador inválido");
      const item=packageSpec(spec), c=connect();
      const activation=await activateAgent(new ApiClient(c.server,c.token),process.cwd(),c.server,item.name,item.range,{adapter:options.adapter,grants:(options.allow??[]).map((v:string)=>permissionSchema.parse(v)) as Permission[],allowedTools:options.allowTool,allowedMcp:options.allowMcp,allowedEnv:options.allowEnv});
      print({agent:`${activation.bundle.agent.name}@${activation.bundle.agent.version}`,adapter:activation.adapter,instructions:".modai/agent.md",mcp:".modai/mcp.json",tools:activation.bundle.capabilities.map(c=>c.name),next:"Configura el MCP de tu cliente con .modai/mcp.json o ejecuta modai agent run"});
    });
  executionOptions(agent.command("run").argument("<task>"))
    .action(async (task,options) => {
      const p=loadProject(), activation=loadActivation(p.paths.root), api=client();
      await verifyBundle(api,activation.bundle,await installationPolicy(api,p.manifest));
      print(await executeAgent(api,activation.bundle,task,runtimeOptions(options,activation)));
    });
  agent.command("submit").argument("<task>").option("--agent <package>","Agente; por defecto el activo").option("--idempotency-key <key>")
    .action(async (task,options) => { const p=loadProject();const item=options.agent?packageSpec(options.agent):(()=>{const a=loadActivation(p.paths.root);return {name:a.bundle.agent.name,range:a.bundle.agent.version}})();print(await client().submitRun({projectId:p.manifest.projectId,...item,task,overrides:p.manifest.overrides,idempotencyKey:options.idempotencyKey})); });
  const runs=program.command("runs").description("Consulta y cancela ejecuciones remotas");
  runs.command("list").action(async()=>print(await client().runs(loadProject().manifest.projectId)));
  runs.command("show").argument("<id>").action(async id=>print(await client().run(id)));
  runs.command("cancel").argument("<id>").action(async id=>print(await client().cancelRun(id)));
  program.command("capabilities").description("Capacidades: contratos provistos/requeridos, herramientas y skills del proyecto").action(async()=>{
    if (isV1Project(process.cwd())) return capabilitiesV1(process.cwd(), print);
    print(await client().capabilities());
  });
  executionOptions(program.command("worker").description("Ejecutor opcional de tareas de un proyecto"))
    .requiredOption("--project <id>").option("--once", "Procesa una tarea y termina").option("--signature-policy <policy>","optional, signed o trusted", "trusted")
    .action(async options => {
      const api=client(); await api.assertCompatible();
      const config=loadClientConfig(), requested=signaturePolicySchema.parse(options.signaturePolicy);
      const order:SignaturePolicy[]=["optional","signed","trusted"], info=await api.health();
      const policy=order[Math.max(order.indexOf(requested),order.indexOf(config?.signaturePolicy??"optional"),order.indexOf(info.signaturePolicy))];
      const controller=new AbortController();const stop=()=>controller.abort();process.once("SIGINT",stop);process.once("SIGTERM",stop);
      try {
        do {
          const worked=await workOnce(api,options.project,{...runtimeOptions(options),signal:controller.signal,signaturePolicy:policy,trustedPublishers:config?.trustedPublishers??[]});
          if(options.once){print({processed:worked});break}
          if(!worked)await delay(2000,undefined,{signal:controller.signal});
        }while(!controller.signal.aborted);
      }catch(error){if(!controller.signal.aborted)throw error}finally{process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop)}
    });
}
