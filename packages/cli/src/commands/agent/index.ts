import type { Command } from "commander";
import type { Print } from "../../terminal/output.js";
import { registerAgentActivate, registerAgentList } from "./activation.js";
import { registerAgentRun, registerAgentRuns, registerAgentSubmit } from "./run.js";
import { registerAgentWorker } from "./worker.js";

export function registerAgentCommands(program: Command, print: Print): void {
  const agent = program
    .command("agent")
    .description("Agentes versionados del servidor: componer, activar, ejecutar, encolar tareas y procesarlas");
  registerAgentList(agent, print);
  registerAgentActivate(agent, print);
  registerAgentRun(agent, print);
  registerAgentSubmit(agent, print);
  registerAgentRuns(agent, print);
  registerAgentWorker(agent, print);
}
