import type { Command } from "commander";

export function group(parent: Command, name: string, description: string): Command {
  return parent.commands.find((command) => command.name() === name) ?? parent.command(name).description(description);
}

export const HELP_SECTIONS: Array<[heading: string, commands: string[]]> = [
  [
    "Proyecto:",
    [
      "init",
      "template",
      "add",
      "feature",
      "remove",
      "sync",
      "update",
      "outdated",
      "status",
      "list",
      "override",
      "workspace",
    ],
  ],
  ["Lo que instalan los paquetes:", ["component", "harness", "capability", "adapter", "permissions"]],
  ["Contexto y memoria:", ["context", "memory", "knowledge"]],
  ["Publicar paquetes:", ["package", "skill", "category", "registry"]],
  ["Servidor:", ["server", "project", "agent", "admin"]],
  ["Este equipo:", ["client", "upgrade"]],
];

export function applyHelpSections(program: Command): void {
  const headings = new Map(HELP_SECTIONS.flatMap(([heading, names]) => names.map((name) => [name, heading] as const)));
  const fallback = HELP_SECTIONS.at(-1)![0];
  const order = HELP_SECTIONS.flatMap(([, names]) => names);
  for (const command of program.commands) command.helpGroup(headings.get(command.name()) ?? fallback);
  const rank = (command: Command) => {
    const index = order.indexOf(command.name());
    return index < 0 ? order.length : index;
  };
  (program.commands as Command[]).sort((a, b) => rank(a) - rank(b));
  program
    .commandsGroup(fallback)
    .helpCommand("help [command]", "Muestra la ayuda de un comando (también: modai <comando> --help)");
}
