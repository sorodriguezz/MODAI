import { state, store } from "../../../app/state.js";
import { textToBytes } from "../../../shared/lib/files.js";

export const MAX_BYTES = 25 * 1024 * 1024;
export const EXCLUDED =
  /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|\.turbo|\.modai\/store|\.DS_Store|Thumbs\.db)(\/|$)|(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/;

export const foldersOf = (paths) =>
  [...new Set(paths.filter((path) => path.includes("/")).map((path) => path.slice(0, path.lastIndexOf("/"))))].sort();

export async function publishableNamespaces() {
  const publish = state.permissions?.publish || { all: false, namespaces: [] };
  return publish.all ? (await store.namespaces().catch(() => [])).map((n) => n.name) : publish.namespaces;
}

export function starterFiles(editorFiles) {
  editorFiles.set(
    "README.md",
    textToBytes("# {{projectName}}\n\nQué es este proyecto, cómo se instala y cómo se ejecuta.\n"),
  );
  editorFiles.set(".gitignore", textToBytes("node_modules/\ndist/\n.env\n.modai/store/\n"));
  editorFiles.set(
    "AGENTS.md",
    textToBytes(
      "# Instrucciones para agentes de {{projectName}}\n\nConvenciones, comandos de verificación y límites del proyecto.\n",
    ),
  );
}

export const nextTemplateVersion = (base) =>
  base ? base.version.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, a, b, c) => `${a}.${b}.${Number(c) + 1}`) : "1.0.0";

export const splitTags = (value, lower = false) =>
  value
    .split(",")
    .map((t) => (lower ? t.trim().toLowerCase() : t.trim()))
    .filter(Boolean);
