import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { API_VERSION } from "@modai/contracts/manifest";
import YAML from "yaml";

export interface ComponentOptions {
  name: string;
  from?: string;
  target?: string;
  component?: string;
  description?: string;
  version?: string;
  language?: string;
  category?: string;
  tags?: string[];
}

function componentName(options: ComponentOptions, short: string): string {
  return (
    (options.component ?? (options.from ? basename(resolve(options.from)) : short))
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+/, "")
      .slice(0, 64) || short
  );
}

function copySource(root: string, from: string): void {
  const source = resolve(from);
  if (!existsSync(source) || !statSync(source).isDirectory())
    throw new Error(`--from debe ser una carpeta existente: ${source}`);
  if (resolve(root).startsWith(`${source}/`)) throw new Error("La carpeta del paquete no puede estar dentro de --from");
  cpSync(source, join(root, "component"), {
    recursive: true,
    filter: (path) => !/(^|[\\/])(node_modules|\.git|dist|\.DS_Store)$/.test(path),
  });
}

function componentManifest(options: ComponentOptions, component: string) {
  return {
    apiVersion: API_VERSION,
    kind: "Package",
    metadata: {
      name: options.name,
      version: options.version ?? "0.1.0",
      description:
        options.description ??
        `Componente ${component}: describe qué resuelve, cómo se integra y qué dependencias espera.`,
    },
    spec: {
      category: options.category ?? "component",
      permissions: ["project.source"],
      contributes: {
        components: [
          {
            name: component,
            description: options.description,
            path: "component",
            target: options.target ?? "src/modules/{component}",
            ...(options.language ? { language: options.language } : {}),
            tags: options.tags ?? [],
          },
        ],
      },
    },
  };
}

export function createComponentPackage(directory: string, options: ComponentOptions): string {
  const root = resolve(directory);
  if (existsSync(root)) throw new Error(`La carpeta ya existe: ${root}`);
  const short = options.name
    .split("/")
    .pop()!
    .replace(/[^a-z0-9-]/g, "-");
  const component = componentName(options, short);
  mkdirSync(join(root, "component"), { recursive: true });
  if (options.from) copySource(root, options.from);
  else
    writeFileSync(
      join(root, "component", "README.md"),
      `# ${component}\n\nCódigo del componente. Todo lo que pongas en esta carpeta se instala en el destino declarado en modai.package.yaml.\n`,
    );
  const manifest = componentManifest(options, component);
  writeFileSync(join(root, "modai.package.yaml"), YAML.stringify(manifest, { lineWidth: 0 }), { flag: "wx" });
  return root;
}
