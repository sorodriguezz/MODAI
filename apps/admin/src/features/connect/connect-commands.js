export const GOALS = {
  editor: {
    label: "Usar MODAI en mi editor",
    icon: "bot",
    role: "publisher",
    needsProject: true,
    mcp: true,
    text: "Claude Code, Cursor, VS Code… Tu asistente usa los paquetes, el conocimiento y la memoria del proyecto.",
  },
  publish: {
    label: "Publicar paquetes",
    icon: "package",
    role: "publisher",
    needsProject: false,
    mcp: false,
    text: "Subir skills, componentes o harnesses desde la terminal con modai package publish.",
  },
  worker: {
    label: "Ejecutar un worker",
    icon: "play",
    role: "worker",
    needsProject: true,
    mcp: false,
    text: "Un equipo que toma tareas de la cola de un proyecto y las ejecuta con un modelo local.",
  },
  explore: {
    label: "Solo explorar",
    icon: "search",
    role: "reader",
    needsProject: false,
    mcp: false,
    text: "Conectar la CLI para ver el catálogo y los proyectos, sin escribir nada.",
  },
};

export const EDITORS = {
  "claude-code": { label: "Claude Code", file: null },
  cursor: { label: "Cursor", file: ".cursor/mcp.json" },
  vscode: { label: "VS Code", file: ".vscode/mcp.json" },
  other: { label: "Otro (JSON estándar)", file: null },
};

function quote(value, shell) {
  return `'${String(value).replaceAll("'", shell === "powershell" ? "''" : "'\\''")}'`;
}

export function serverOrigin(value) {
  const url = new URL(value);
  const extra = url.username || url.password || url.pathname !== "/" || url.search || url.hash;
  if (!["http:", "https:"].includes(url.protocol) || extra)
    throw new Error("Usa la URL HTTP(S) del servidor, sin ruta ni credenciales.");
  return url.origin;
}

function editorLines(q, project, agent) {
  const lines = [
    [
      "En la carpeta del repositorio: vincúlalo al proyecto (si ya tiene modai.yaml, usa modai sync)",
      `modai init --project ${q(project)}`,
    ],
  ];
  if (agent)
    lines.push([
      "Activa el agente: instala sus instrucciones, skills y herramientas",
      `modai agent activate ${q(agent)} --adapter agents-md --allow project.instructions`,
    ]);
  lines.push(["Revisa lo instalado", "modai status"]);
  return lines;
}

const GOAL_LINES = {
  editor: (q, project, agent) => editorLines(q, project, agent),
  publish: () => [
    [
      "Crea un paquete nuevo (o usa una carpeta existente)",
      "modai package scaffold ./mi-paquete --name @mi-namespace/mi-paquete",
    ],
    ["Valida su calidad", "modai package validate ./mi-paquete"],
    ["Publícalo (también acepta un archivo .skill)", "modai package publish ./mi-paquete"],
  ],
  worker: (q, project) => [
    [
      "Toma tareas de la cola del proyecto con un modelo local (Ollama)",
      `modai agent worker --project ${q(project)} --model MODELO_LOCAL`,
    ],
  ],
};

export function commandLines({ goal, server, project, agent, shell }) {
  const q = (value) => quote(value, shell);
  const lines = [
    ["Instala la CLI (una vez por equipo; requiere Node 26.13+)", "npm install -g @sorodriguez/modai"],
    [
      "Conecta con el servidor: pide la API key con entrada oculta y la guarda fuera del repositorio",
      `modai server connect ${q(serverOrigin(server))}`,
    ],
    ["Comprueba tu identidad y lo que puedes hacer", "modai server whoami"],
  ];
  const extra = GOAL_LINES[goal]?.(q, project, agent) ?? [["Lista los paquetes publicados", "modai registry packages"]];
  lines.push(...extra);
  return lines.map(([comment, command]) => `# ${comment}\n${command}`).join("\n\n");
}

export function mcpSnippet(editor) {
  const args = ["--project", "/RUTA/ABSOLUTA/DEL/REPOSITORIO"];
  if (editor === "claude-code") return `claude mcp add modai -- modai-mcp ${args.join(" ")}`;
  if (editor === "vscode")
    return JSON.stringify({ servers: { modai: { type: "stdio", command: "modai-mcp", args } } }, null, 2);
  return JSON.stringify({ mcpServers: { modai: { command: "modai-mcp", args } } }, null, 2);
}

export function mcpHint(editor) {
  if (editor === "claude-code") return "Ejecuta en la carpeta del repositorio, reemplazando la ruta absoluta:";
  const file = EDITORS[editor].file;
  return file
    ? `Guarda esto en ${file} dentro del repositorio, reemplazando la ruta absoluta:`
    : "Añade este servidor MCP a la configuración de tu asistente, reemplazando la ruta absoluta:";
}
