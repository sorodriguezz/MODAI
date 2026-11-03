import type { Command } from "commander";

/** Returns the subcommand `name` of `parent`, creating it on first use (several modules add to one group). */
export function group(parent: Command, name: string, description: string): Command {
  return parent.commands.find(command => command.name() === name) ?? parent.command(name).description(description);
}

/** Help sections of `modai --help`, in display order. Commands not listed fall under the last one. */
export const HELP_SECTIONS: Array<[heading: string, commands: string[]]> = [
  ["Proyecto:", ["init", "add", "remove", "sync", "update", "outdated", "status", "list", "override", "migrate", "workspace"]],
  ["Lo que instalan los paquetes:", ["component", "harness", "capability", "adapter", "permissions"]],
  ["Contexto y memoria:", ["context", "memory"]],
  ["Publicar paquetes:", ["package", "registry"]],
  ["Servidor:", ["server", "project", "agent", "admin"]],
  ["Este equipo:", ["client", "upgrade"]],
];

export function applyHelpSections(program: Command): void {
  const headings = new Map(HELP_SECTIONS.flatMap(([heading, names]) => names.map(name => [name, heading] as const)));
  const fallback = HELP_SECTIONS.at(-1)![0];
  const order = HELP_SECTIONS.flatMap(([, names]) => names);
  for (const command of program.commands) command.helpGroup(headings.get(command.name()) ?? fallback);
  // Commander lists commands in registration order: sort them to follow the sections.
  const rank = (command: Command) => { const index = order.indexOf(command.name()); return index < 0 ? order.length : index; };
  (program.commands as Command[]).sort((a, b) => rank(a) - rank(b));
  program.commandsGroup(fallback).helpCommand("help [command]", "Muestra la ayuda de un comando (también: modai <comando> --help)");
}

/**
 * Commands that moved into a group in 0.9. The old spelling keeps working (hidden from the help) and prints
 * where the command lives now. Keys of two words are matched before keys of one.
 */
export const LEGACY_COMMANDS: Record<string, string[]> = {
  connect: ["server", "connect"],
  logout: ["server", "logout"],
  disconnect: ["server", "logout"],
  whoami: ["server", "whoami"],
  ping: ["server", "ping"],
  search: ["context", "search"],
  remember: ["memory", "add"],
  recall: ["memory", "search"],
  memories: ["memory", "list"],
  forget: ["memory", "remove"],
  "memory-update": ["memory", "update"],
  publish: ["package", "publish"],
  deprecate: ["package", "deprecate"],
  yank: ["package", "yank"],
  unpublish: ["package", "unpublish"],
  grant: ["permissions", "grant"],
  revoke: ["permissions", "revoke"],
  trust: ["permissions", "trust"],
  signatures: ["permissions", "signatures"],
  capabilities: ["capability", "list"],
  providers: ["capability", "providers"],
  provider: ["capability", "use"],
  "tools list": ["capability", "tools"],
  "tools run": ["capability", "run"],
  tools: ["capability", "tools"],
  runs: ["agent", "runs"],
  worker: ["agent", "worker"],
  embed: ["client", "embed"],
  "admin create-project": ["project", "create"],
};

/** Rewrites a legacy command in `argv` (node, script, ...args) to its new place. */
export function rewriteLegacyCommand(argv: string[], warn: (message: string) => void): string[] {
  const start = argv.findIndex((value, index) => index >= 2 && !value.startsWith("-"));
  if (start < 0) return argv;
  for (const length of [2, 1]) {
    const key = argv.slice(start, start + length).join(" ");
    const target = argv.length >= start + length ? LEGACY_COMMANDS[key] : undefined;
    if (!target) continue;
    warn(`Aviso: 'modai ${key}' ahora es 'modai ${target.join(" ")}'. El nombre antiguo dejará de funcionar en una próxima versión.\n`);
    return [...argv.slice(0, start), ...target, ...argv.slice(start + length)];
  }
  return argv;
}
