import type { Command } from "commander";
import { indexKnowledge, loadLocalModels, semanticSearch } from "../../client/embeddings.js";
import { projectOrServerApi } from "../../services/connection.js";
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
    .action(async (o: { package?: string }) =>
      print(
        await indexKnowledge(projectOrServerApi(), loadLocalModels(), (s) => process.stderr.write(`${s}\n`), o.package),
      ),
    );
  embed
    .command("search")
    .description("Búsqueda semántica con el modelo local")
    .argument("<query>")
    .action(async (query: string) => {
      const results = await semanticSearch(projectOrServerApi(), loadLocalModels(), query);
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
