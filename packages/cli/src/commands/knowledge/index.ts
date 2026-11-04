import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { serverApi } from "../../services/connection.js";
import { group } from "../../terminal/help-sections.js";
import { commaList } from "../../terminal/options.js";
import type { Print } from "../../terminal/output.js";

type DocumentOptions = { title?: string; file?: string; content?: string; tags?: string[] };
const contentOf = (options: DocumentOptions) =>
  options.file ? readFileSync(resolve(options.file), "utf8") : options.content;

function registerKnowledgeRead(knowledge: Command, print: Print): void {
  knowledge
    .command("list")
    .alias("ls")
    .description("Documentos de conocimiento (manuales y de paquetes)")
    .option("--manual", "Solo los creados a mano (editables)")
    .action(async (options: { manual?: boolean }) => {
      const api = serverApi(),
        documents = [];
      for (let offset: number | null = 0; offset !== null; ) {
        const page = await api.knowledgeDocuments(offset);
        documents.push(...page.documents);
        offset = page.nextOffset;
      }
      print(
        documents
          .filter((doc) => !options.manual || !doc.packageName)
          .map((doc) => ({ id: doc.id, title: doc.title, package: doc.packageName ?? "manual" })),
      );
    });
  knowledge
    .command("show")
    .description("Muestra un documento")
    .argument("<id>")
    .action(async (id: string) => {
      const api = serverApi();
      for (let offset: number | null = 0; offset !== null; ) {
        const page = await api.knowledgeDocuments(offset);
        const found = page.documents.find((doc) => doc.id === id);
        if (found) return print(found);
        offset = page.nextOffset;
      }
      throw new Error(`No existe el documento ${id}`);
    });
  knowledge
    .command("search")
    .description("Busca en el conocimiento compartido")
    .argument("<query>")
    .action(async (query: string) => print(await serverApi().searchKnowledge(query)));
}

function registerKnowledgeWrite(knowledge: Command, print: Print): void {
  knowledge
    .command("add")
    .description("Crea un documento manual (texto o archivo Markdown)")
    .requiredOption("--title <title>", "Título")
    .option("--file <path>", "Archivo con el contenido")
    .option("--content <text>", "Contenido en línea")
    .option("--tags <tags>", "Etiquetas separadas por comas", commaList)
    .action(async (options: DocumentOptions & { title: string }) => {
      const content = contentOf(options);
      if (!content) throw new Error("Indica --file o --content");
      const document = await serverApi().createKnowledge({ title: options.title, content, tags: options.tags });
      print(`Documento creado: ${document.id}`);
    });
  knowledge
    .command("update")
    .description("Actualiza un documento manual")
    .argument("<id>")
    .option("--title <title>")
    .option("--file <path>")
    .option("--content <text>")
    .option("--tags <tags>", "Etiquetas separadas por comas", commaList)
    .action(async (id: string, options: DocumentOptions) => {
      await serverApi().updateKnowledge(id, { title: options.title, content: contentOf(options), tags: options.tags });
      print(`Documento actualizado: ${id}`);
    });
  knowledge
    .command("remove")
    .alias("rm")
    .description("Elimina un documento manual")
    .argument("<id>")
    .action(async (id: string) => {
      await serverApi().deleteKnowledge(id);
      print(`Documento eliminado: ${id}`);
    });
}

export function registerKnowledgeCommands(program: Command, print: Print): void {
  const knowledge = group(
    program,
    "knowledge",
    "Conocimiento compartido del servidor: documentos que los agentes consultan",
  );
  registerKnowledgeRead(knowledge, print);
  registerKnowledgeWrite(knowledge, print);
}
