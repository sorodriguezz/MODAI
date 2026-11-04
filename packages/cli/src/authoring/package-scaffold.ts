import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { API_VERSION } from "@modai/contracts/manifest";
import YAML from "yaml";

export interface ScaffoldOptions {
  name: string;
  kind?: string;
  category?: string;
  withTool?: boolean;
}

type Spec = Record<string, unknown>;
type Files = Record<string, string>;

const SKILL = (short: string) =>
  `---\nname: ${short}\ndescription: Explica qué logra esta skill, cuándo debe activarse y qué solicitudes quedan fuera de su alcance.\n---\n\n# ${short}\n\nDefine el resultado esperado, las decisiones no obvias y los límites reales.\n\n## Flujo\n\n1. Inspecciona el contexto relevante.\n2. Ejecuta el trabajo manteniendo el alcance solicitado.\n3. Verifica el resultado con evidencia observable.\n`;
const TOOL_SCRIPT = `// Recibe JSON por stdin y responde JSON por stdout. Se ejecuta sin shell, con el proyecto como cwd.\nlet raw = "";\nfor await (const chunk of process.stdin) raw += chunk;\nconst input = JSON.parse(raw || "{}");\nconsole.log(JSON.stringify({ ok: true, received: input, project: process.env.MODAI_PROJECT_DIR }));\n`;

function addTool(spec: Spec, files: Files, tool: string): void {
  spec.permissions = ["process.execute", "filesystem.read"];
  spec.include = ["tools"];
  spec.contributes = {
    tools: [
      {
        name: tool,
        description: `Describe qué hace ${tool} y qué devuelve.`,
        implements: (spec.provides as string[])[0].split("@")[0],
        command: "node",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: placeholder the Core expands at run time
        args: ["${packageDir}/tools/run.mjs"],
        inputSchema: {
          type: "object",
          properties: { target: { type: "string", maxLength: 500 } },
          additionalProperties: false,
        },
      },
    ],
  };
  files["tools/run.mjs"] = TOOL_SCRIPT;
}

function packageKind(spec: Spec, files: Files, short: string, options: ScaffoldOptions): void {
  spec.provides = [`${options.category ?? "general"}.${short}@1.0.0`];
  spec.entrypoints = { skills: "skills", knowledge: "knowledge", rules: "rules" };
  files[`skills/${short}/SKILL.md`] = SKILL(short);
  files["knowledge/README.md"] =
    `# ${short}\n\nConocimiento que el agente recupera bajo demanda con modai_search_knowledge.\n`;
  files["rules/README.md"] = "Regla breve que el adaptador incorpora a las instrucciones del agente.\n";
  if (options.withTool) addTool(spec, files, short.replaceAll("-", "_").slice(0, 40));
}

function adapterKind(spec: Spec, short: string): void {
  spec.permissions = ["project.instructions"];
  spec.adapter = {
    id: short,
    description: `Materializa capacidades MODAI para ${short}.`,
    targets: {
      skills: { path: `.${short}/skills/{skill}` },
      rules: { mode: "file", path: `.${short}/rules/{package}-{rule}.md` },
      mcp: { file: `.${short}/mcp.json`, pointer: "mcpServers.modai" },
    },
  };
}

export function scaffoldPackage(directory: string, options: ScaffoldOptions): string {
  const root = resolve(directory);
  if (existsSync(root)) throw new Error(`La carpeta ya existe: ${root}`);
  const kind = (options.kind ?? "package").replace(/^./, (char) => char.toUpperCase());
  if (!["Package", "Profile", "Adapter"].includes(kind)) throw new Error("--kind debe ser package, profile o adapter");
  const short = options.name
    .split("/")
    .pop()!
    .replace(/[^a-z0-9-]/g, "-");
  const spec: Spec = {
    category: options.category ?? "general",
    dependencies: {},
    provides: [],
    requires: [],
    permissions: [],
  };
  const files: Files = {};
  if (kind === "Package") packageKind(spec, files, short, options);
  else if (kind === "Profile") spec.dependencies = { "@scope/paquete": "^1.0.0" };
  else adapterKind(spec, short);
  const manifest = {
    apiVersion: API_VERSION,
    kind,
    metadata: {
      name: options.name,
      version: "0.1.0",
      description: `Describe con precisión qué aporta ${options.name} y cuándo usarlo.`,
    },
    spec,
  };
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "modai.package.yaml"), YAML.stringify(manifest, { lineWidth: 0 }), { flag: "wx" });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content, { flag: "wx" });
  }
  return root;
}
