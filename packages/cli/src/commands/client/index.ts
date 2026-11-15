import type { Command } from "commander";
import { indexKnowledge, loadLocalModels, semanticSearch } from "../../client/embeddings.js";
import { projectOrServerApi } from "../../services/connection.js";
import { profileConnection } from "../../services/profile.js";
import type { Print } from "../../terminal/output.js";
import { registerClientBenchmark, registerClientDoctor } from "./diagnostics.js";
import { registerClientSetup } from "./setup.js";

function registerClientEmbed(client: Command, print: Print): void {
  const embed = client
    .command("embed")
    .description(
      "Indexación y búsqueda semántica del conocimiento del servidor: embeddings calculados solo en este equipo",
    );
  embed
    .command("index")
    .description("Calcula y sube los vectores de los documentos de conocimiento")
    .option("--package <name>", "Indexar solo los documentos de este paquete")
    .option("--project <id>", "Indexar los documentos privados del proyecto")
    .action(async (options: { package?: string; project?: string }) => {
      if (options.package && options.project) throw new Error("Elige --package o --project");
      const api = options.project ? profileConnection(options.project).api : projectOrServerApi();
      print(
        await indexKnowledge(
          api,
          loadLocalModels(),
          (line) => process.stderr.write(`${line}\n`),
          options.package,
          options.project,
        ),
      );
    });
  embed
    .command("search")
    .description("Búsqueda semántica con el modelo local")
    .argument("<query>")
    .option("--project <id>", "Busca en el conocimiento y las versiones del proyecto")
    .action(async (query: string, options: { project?: string }) => {
      const project = options.project ? profileConnection(options.project) : undefined;
      const results = await semanticSearch(
        project?.api ?? projectOrServerApi(),
        loadLocalModels(),
        query,
        undefined,
        project,
      );
      print({
        results,
        ...(!results.length
          ? {
              hint: "Sin vectores compatibles. Ejecuta modai client embed index con este mismo modelo y digest, o usa modai context search para búsqueda de texto.",
            }
          : {}),
      });
    });
}

export function registerClientCommands(program: Command, print: Print): void {
  const client = program
    .command("client")
    .description("Hardware, modelos y embeddings en este equipo; sin inferencia en el servidor");
  registerClientDoctor(client, print);
  registerClientSetup(client, print);
  registerClientBenchmark(client, print);
  registerClientEmbed(client, print);
}
