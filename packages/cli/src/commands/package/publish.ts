import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { PublishPackageInput } from "@modai/contracts/types";
import { loadPackageSource, validatePackage } from "@modai/core";
import type { Command } from "commander";
import { signPackage } from "../../authoring/signing.js";
import { resolveNamespace, skillSourceToPackage } from "../../authoring/skill-package.js";
import { serverApi } from "../../services/connection.js";
import { currentProject } from "../../services/project.js";
import { registryFromArgument } from "../../services/registries.js";
import type { Print } from "../../terminal/output.js";

type PublishOptions = { key?: string; registry?: string; namespace?: string; skillVersion?: string };

async function packageInput(directory: string, options: PublishOptions, print: Print): Promise<PublishPackageInput> {
  if (!(directory.toLowerCase().endsWith(".skill") && statSync(resolve(directory)).isFile()))
    return loadPackageSource(resolve(directory));
  if (!options.namespace && options.registry) throw new Error("Indica --namespace para publicar un .skill");
  const namespace = await resolveNamespace(serverApi(), options.namespace);
  const { skill, ...converted } = skillSourceToPackage(directory, { namespace, version: options.skillVersion });
  print(`Skill «${skill.name}» convertida a ${namespace}/${skill.name} (${converted.files.length} archivos).`);
  return converted;
}

async function publishToRegistry(directory: string, value: string, input: PublishPackageInput, print: Print) {
  const registry = registryFromArgument(value, currentProject());
  if (!registry.publish) throw new Error(`${registry.id} no admite publicación`);
  const result = await registry.publish(input);
  print(`Publicado ${result.name}@${result.version} en ${registry.id} (${result.integrity}) desde ${directory}`);
}

export function registerPackagePublish(pkg: Command, print: Print): void {
  pkg
    .command("publish")
    .description(
      "Publica un paquete inmutable en un registry (servidor MODAI o carpeta local). Acepta una carpeta o un archivo .skill",
    )
    .argument("[directory]", "Carpeta del paquete o archivo .skill", ".")
    .option("--key <private-key>", "Firma el paquete con una clave privada Ed25519")
    .option("--registry <name|url|path>", "Registry destino; por defecto el servidor conectado")
    .option("--namespace <@scope>", "Para .skill: namespace del paquete (por defecto, el único donde puedes publicar)")
    .option("--skill-version <semver>", "Para .skill: versión (por defecto la del frontmatter o 1.0.0)")
    .action(async (directory: string, options: PublishOptions) => {
      let input = await packageInput(directory, options, print);
      validatePackage(input.manifest, input.files);
      if (options.key) input = signPackage(input, readFileSync(resolve(options.key), "utf8"));
      if (options.registry) return publishToRegistry(resolve(directory), options.registry, input, print);
      const published = await serverApi().publish(input);
      print(
        `Publicado ${published.name}@${published.version}, calidad ${published.quality?.score ?? "—"}/100${published.signerFingerprint ? ", firmado" : ""}.`,
      );
    });
}
