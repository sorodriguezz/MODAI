#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Command } from "commander";
import { Ajv } from "ajv";
import { ApiClient } from "@modai/sdk";
import { loadProject } from "./cli/config.js";
import { effectiveConnection } from "./cli/connection.js";
import { loadLocalModels, semanticSearch } from "./client/embeddings.js";
import { loadActivation, verifyBundle, agentInstructions } from "./agent/activation.js";
import { CapabilityHost, type ToolDescription } from "./agent/capabilities.js";
import { installationPolicy } from "./cli/installer.js";
import { runtimeOptions } from "./cli/agent-commands.js";
import { isV1Project } from "@modai/core/project";
import { startV1Gateway } from "./v1/gateway.js";

const options = new Command().option("--project <path>", "Directorio del proyecto", process.cwd()).option("--bindings <file>", "Bindings de herramientas locales").parse().opts();
const root = resolve(options.project);
if (isV1Project(root)) {
  // v1 projects work offline: the gateway reads the local store, index and grants.
  await startV1Gateway(root);
} else {
let project: ReturnType<typeof loadProject> | undefined;
try { project = loadProject(root); } catch (error) { if (existsSync(resolve(root,".modai"))) throw error; }
const connection = effectiveConnection(project?.manifest.server);
const api = new ApiClient(connection.server, connection.token);
await api.assertCompatible();
const mcp = new Server({ name: "modai", version: "0.7.1" }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const querySchema = { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["query"], additionalProperties: false };
const noArguments = { type: "object", properties: {}, additionalProperties: false };
const builtins: Array<ToolDescription & { readOnly: boolean; call: (input: Record<string, unknown>) => Promise<unknown> }> = [
  { name: "modai_search_knowledge", description: "Busca conocimiento de los paquetes del proyecto.", inputSchema: querySchema, readOnly: true,
    call: async input => api.searchKnowledge(input.query as string,project?.lock.packages.map(p=>p.name)) },
  { name: "modai_semantic_search", description: "Búsqueda semántica con embeddings calculados en este cliente.", inputSchema: querySchema, readOnly: true,
    call: async input => semanticSearch(api,loadLocalModels(),input.query as string,project?.lock.packages.map(p=>p.name)) },
  { name: "modai_recall", description: "Recupera memoria del proyecto.", inputSchema: querySchema, readOnly: true,
    call: async input => {if(!project)throw new Error("Inicializa el proyecto");return api.recall(project.manifest.projectId,input.query as string)} },
  { name: "modai_remember", description: "Guarda una decisión durable del proyecto. No guardar secretos.", inputSchema: {type:"object",properties:{content:{type:"string",minLength:1,maxLength:100000},kind:{type:"string",enum:["decision","constraint","lesson","note"]}},required:["content"],additionalProperties:false}, readOnly: false,
    call: async input => {if(!project)throw new Error("Inicializa el proyecto");return api.remember({projectId:project.manifest.projectId,content:input.content as string,kind:(input.kind as string)??"note"})} },
  { name: "modai_list_packages", description: "Consulta el catálogo central de capacidades.", inputSchema: {type:"object",properties:{query:{type:"string",maxLength:2000}},additionalProperties:false},readOnly:true,call:async input=>api.listPackages(input.query as string|undefined) },
  { name: "modai_project_status", description: "Identidad y versiones instaladas del proyecto.",inputSchema:noArguments,readOnly:true,call:async()=>project?{projectId:project.manifest.projectId,requested:project.manifest.packages,installed:project.lock.packages}:{initialized:false} },
  { name: "modai_list_agents",description:"Lista agentes versionados publicados.",inputSchema:noArguments,readOnly:true,call:async()=>api.agents() },
  { name: "modai_list_capabilities",description:"Descubre capacidades declaradas por los paquetes.",inputSchema:noArguments,readOnly:true,call:async()=>api.capabilities() },
];
let host: CapabilityHost | undefined;
let activeInstructions: string | undefined;
if (project && existsSync(resolve(root,".modai/activation.json"))) {
  const activation=loadActivation(root);
  activeInstructions=agentInstructions(activation.bundle);
  await verifyBundle(api,activation.bundle,await installationPolicy(api,project.manifest));
  host=new CapabilityHost(api,activation.bundle,{...runtimeOptions(options,activation),cwd:root});
  await host.start();
  // Activated agents expose exactly their selected tools. Generic write tools must not bypass their policy.
  for(let i=builtins.length-1;i>=0;i--) {
    if(["modai_remember","modai_recall","modai_search_knowledge","modai_semantic_search"].includes(builtins[i].name))builtins.splice(i,1);
  }
}
const ajv=new Ajv({strict:false,validateFormats:false});
const validators=new Map(builtins.map(tool=>[tool.name,ajv.compile(tool.inputSchema)]));
for(const tool of host?.list()??[])if(validators.has(tool.name))throw new Error(`Colisión con herramienta reservada: ${tool.name}`);
mcp.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...builtins.map(({call,readOnly,...tool})=>({...tool,inputSchema:tool.inputSchema as {type:"object"},annotations:{readOnlyHint:readOnly}})),...(host?.list()??[]).map(tool=>({...tool,inputSchema:tool.inputSchema as {type:"object"}}))]}));
mcp.setRequestHandler(CallToolRequestSchema,async request=>{
  try {
    const name=request.params.name,input=request.params.arguments??{},builtin=builtins.find(tool=>tool.name===name);
    if(builtin){if(!validators.get(name)!(input))throw new Error("Argumentos inválidos");return result(await builtin.call(input));}
    if(host)return result(await host.call(name,input));
    throw new Error("Herramienta no habilitada");
  }catch(error){return {...result({error:(error as Error).message}),isError:true};}
});
mcp.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:activeInstructions?[{uri:"modai://agent/active",name:"active-agent",description:"Instrucciones y skills del agente activo",mimeType:"text/markdown"}]:[]}));
mcp.setRequestHandler(ReadResourceRequestSchema,async request=>{
  if(request.params.uri!=="modai://agent/active"||!activeInstructions)throw new Error("Recurso no disponible");
  return {contents:[{uri:request.params.uri,mimeType:"text/markdown",text:activeInstructions}]};
});
mcp.setRequestHandler(ListPromptsRequestSchema,async()=>({prompts:activeInstructions?[{name:"modai_agent",description:"Aplica el agente activo a una tarea",arguments:[{name:"task",description:"Tarea del proyecto",required:true}]}]:[]}));
mcp.setRequestHandler(GetPromptRequestSchema,async request=>{
  const task=request.params.arguments?.task;
  if(request.params.name!=="modai_agent"||!activeInstructions||!task||task.length>50000)throw new Error("Prompt o tarea inválidos");
  return {description:"Agente MODAI activo",messages:[{role:"user" as const,content:{type:"text" as const,text:activeInstructions+"\n\n## Tarea\n\n"+task}}]};
});
let closing=false;
const close=async()=>{if(closing)return;closing=true;await host?.close();await mcp.close();};
mcp.onclose=()=>{void host?.close()};
process.once("SIGTERM",()=>void close());process.once("SIGINT",()=>void close());
await mcp.connect(new StdioServerTransport());
}
