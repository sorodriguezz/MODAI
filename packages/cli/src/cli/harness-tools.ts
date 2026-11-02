import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { safeProjectPath, writeProjectFile } from "./safe-path.js";

interface HarnessAudit {
  score: number;
  dimensions: Record<string, number>;
  recommendations: string[];
}

function writeManaged(root: string, target: string, content: string, force: boolean): void {
  const path = safeProjectPath(root,target);
  if (existsSync(path) && !force) throw new Error(`Ya existe ${path}. Usa --force únicamente si quieres reemplazarlo.`);
  writeProjectFile(root,target,content);
}

function detectCommands(root: string): { setup: string; checks: string[] } {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return { setup: "Define el comando de instalación", checks: ["Define el comando de verificación"] };
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string>; packageManager?: string };
  const runner = pkg.packageManager?.startsWith("pnpm") ? "pnpm" : pkg.packageManager?.startsWith("yarn") ? "yarn" : pkg.packageManager?.startsWith("bun") ? "bun" : "npm";
  const setup = runner === "npm" ? "npm install" : `${runner} install`;
  const scripts = pkg.scripts ?? {};
  const checks = ["test", "lint", "typecheck", "check", "build"].filter((name) => scripts[name]).map((name) => `${runner} run ${name}`);
  return { setup, checks: checks.length ? checks : ["Define un script de verificación en package.json"] };
}

export function createHarness(directory: string, agentFile = "AGENTS.md", force = false): string[] {
  const root = resolve(directory);
  if (!["AGENTS.md", "CLAUDE.md"].includes(agentFile)) throw new Error("agent-file debe ser AGENTS.md o CLAUDE.md");
  const commands = detectCommands(root);
  const verification = commands.checks.map((command) => `- \`${command}\``).join("\n");
  const created = [
    agentFile,
    ".agent/feature_list.json",
    ".agent/progress.md",
    ".agent/session-handoff.md",
    ".agent/verification.md",
    ".agent/quality.md",
  ];
  writeManaged(root, agentFile, `# Instrucciones del agente\n\n## Inicio\n\n1. Lee \`.agent/progress.md\` y la única función activa en \`.agent/feature_list.json\`.\n2. Ejecuta \`${commands.setup}\` solo si faltan dependencias.\n3. Consulta \`.agent/verification.md\` antes de cambiar código.\n\n## Invariantes\n\n- Mantén WIP=1: termina o bloquea la función activa antes de iniciar otra.\n- El repositorio es la fuente de verdad; registra decisiones durables en documentación versionada.\n- No declares finalización sin evidencia ejecutable.\n- Conserva el alcance solicitado y no reescribas áreas no relacionadas.\n- No ocultes fallos de verificación ni reduzcas cobertura para hacer pasar una tarea.\n\n## Enrutamiento\n\n- Estado y siguiente acción: \`.agent/progress.md\`.\n- Alcance y gates: \`.agent/feature_list.json\`.\n- Comandos y Definition of Done: \`.agent/verification.md\`.\n- Continuidad entre sesiones: \`.agent/session-handoff.md\`.\n- Salud acumulada: \`.agent/quality.md\`.\n\n## Cierre\n\nDeja build y pruebas en estado conocido, registra comandos ejecutados y actualiza el handoff con lo verificado, lo pendiente y la mejor próxima acción.\n`, force);
  writeManaged(root, ".agent/feature_list.json", `${JSON.stringify({ schemaVersion: 1, wipLimit: 1, features: [{ id: "feat-001", behavior: "Reemplazar con una conducta observable", verification: commands.checks[0], status: "not_started", dependencies: [] }] }, null, 2)}\n`, force);
  writeManaged(root, ".agent/progress.md", `# Progreso\n\n## Estado verificado actual\n\n- Función activa: ninguna\n- Última verificación: no ejecutada\n- Bloqueos: ninguno registrado\n\n## Próxima acción\n\nSeleccionar una sola función de \`feature_list.json\` y registrar su criterio observable.\n`, force);
  writeManaged(root, ".agent/session-handoff.md", `# Entrega de sesión\n\n## Verificado ahora\n\nPendiente.\n\n## Cambiado en esta sesión\n\nPendiente.\n\n## Roto o sin verificar\n\nPendiente.\n\n## Mejor próximo paso\n\nPendiente.\n\n## Comandos ejecutados\n\nPendiente.\n`, force);
  writeManaged(root, ".agent/verification.md", `# Verificación\n\n## Instalación\n\n- \`${commands.setup}\`\n\n## Gates ejecutables\n\n${verification}\n\n## Definition of Done\n\n- El comportamiento solicitado tiene evidencia reproducible.\n- Los gates aplicables pasan, o sus fallos preexistentes están registrados.\n- No quedan artefactos temporales ni cambios no explicados.\n- Progreso y handoff reflejan el estado real.\n`, force);
  writeManaged(root, ".agent/quality.md", `# Salud del harness\n\n| Dimensión | Estado | Evidencia |\n|---|---|---|\n| Instrucciones | B | Router raíz creado |\n| Estado | C | Falta poblar funciones reales |\n| Verificación | C | Revisar comandos detectados |\n| Alcance | B | WIP=1 configurado |\n| Ciclo de vida | B | Handoff creado |\n`, force);
  return created;
}

export function auditHarness(directory: string): HarnessAudit {
  const root = resolve(directory);
  const read = (path: string): string => existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : "";
  const instructions = read("AGENTS.md") || read("CLAUDE.md");
  const state = read(".agent/feature_list.json") + read(".agent/progress.md");
  const verification = read(".agent/verification.md") + instructions;
  const lifecycle = read(".agent/session-handoff.md") + read(".agent/progress.md");
  const dimensions = {
    instructions: instructions ? (instructions.length < 15_000 ? 100 : 60) : 0,
    state: /feature|progress|estado|status/i.test(state) ? 100 : 0,
    verification: /test|lint|check|build|verific|evidencia/i.test(verification) ? 100 : 0,
    scope: /wip|alcance|scope|not_started|blocked|passing/i.test(instructions + state) ? 100 : 0,
    lifecycle: /handoff|próxim|next|sesión|session/i.test(lifecycle) ? 100 : 0,
  };
  const recommendations: string[] = [];
  if (dimensions.instructions < 80) recommendations.push("Crea un AGENTS.md breve que funcione como router e incluya invariantes.");
  if (dimensions.state < 80) recommendations.push("Externaliza función activa, estado, evidencia y siguiente acción.");
  if (dimensions.verification < 80) recommendations.push("Documenta gates ejecutables y una Definition of Done.");
  if (dimensions.scope < 80) recommendations.push("Añade WIP=1 y estados controlados por evidencia.");
  if (dimensions.lifecycle < 80) recommendations.push("Añade progress y session-handoff para reinicios en frío.");
  const score = Math.round(Object.values(dimensions).reduce((sum, value) => sum + value, 0) / 5);
  return { score, dimensions, recommendations };
}
