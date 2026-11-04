import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeZip } from "@modai/core";
import type { ApiClient } from "@modai/sdk";
import type { Command } from "commander";
import { resolveNamespace, skillSourceToPackage } from "../../authoring/skill-package.js";
import { serverApi } from "../../services/connection.js";
import { splitVersionSpec } from "../../services/package-spec.js";
import { group } from "../../terminal/help-sections.js";
import type { Print } from "../../terminal/output.js";

type SkillRef = { name: string; path: string };
type PublishOptions = { namespace?: string; name?: string; skillVersion?: string; dryRun?: boolean };

function registerSkillList(skill: Command, print: Print): void {
  skill
    .command("list")
    .alias("ls")
    .description("Paquetes del servidor que aportan skills")
    .argument("[query]", "Filtra por texto")
    .action(async (query?: string) =>
      print(
        (await serverApi().catalog({ type: "skills", q: query, limit: 100 })).items.map((item) => ({
          name: item.name,
          version: item.version,
          description: item.description,
        })),
      ),
    );
}

function registerSkillPublish(skill: Command, print: Print): void {
  skill
    .command("publish")
    .description("Publica una skill: archivo .skill/.zip o carpeta con SKILL.md")
    .argument("<source>", "Archivo .skill o carpeta de la skill")
    .option("--namespace <@scope>", "Namespace del paquete (por defecto, el único donde puedes publicar)")
    .option("--name <name>", "Nombre de la skill (por defecto, el del frontmatter)")
    .option("--skill-version <semver>", "Versión (por defecto la del frontmatter o 1.0.0)")
    .option("--dry-run", "Muestra el paquete resultante sin publicarlo")
    .action(async (source: string, options: PublishOptions) => {
      const api = serverApi();
      const { skill: info, ...input } = skillSourceToPackage(source, {
        namespace: await resolveNamespace(api, options.namespace),
        version: options.skillVersion,
        name: options.name,
      });
      const manifest = input.manifest as unknown as { metadata: { name: string; version: string } };
      if (options.dryRun)
        return print({
          package: `${manifest.metadata.name}@${manifest.metadata.version}`,
          skill: info.name,
          description: info.description,
          files: input.files.map((file) => file.path),
        });
      const published = await api.publish(input);
      print(
        `Publicada la skill «${info.name}» como ${published.name}@${published.version} (calidad ${published.quality?.score ?? "—"}/100).`,
      );
    });
}

async function chooseSkill(api: ApiClient, spec: string, wanted: string | undefined, print: Print) {
  const { name, version } = splitVersionSpec(spec);
  const record = await api.getPackage(name, version);
  const skills =
    (record.manifest as unknown as { spec?: { contributes?: { skills?: SkillRef[] } } }).spec?.contributes?.skills ??
    [];
  const chosen = wanted ? skills.find((item) => item.name === wanted) : skills[0];
  if (!chosen)
    throw new Error(
      skills.length
        ? `El paquete no tiene la skill ${wanted}. Tiene: ${skills.map((item) => item.name).join(", ")}`
        : `${name} no aporta skills`,
    );
  if (skills.length > 1 && !wanted)
    print(`El paquete aporta ${skills.length} skills; se exporta «${chosen.name}». Usa --skill para otra.`);
  return { record, chosen };
}

function registerSkillExport(skill: Command, print: Print): void {
  skill
    .command("export")
    .description("Descarga una skill publicada como archivo .skill (para Claude u otro agente)")
    .argument("<package>", "@scope/nombre[@versión]")
    .argument("[file]", "Archivo destino (por defecto <skill>.skill)")
    .option("--skill <name>", "Skill a exportar si el paquete aporta varias")
    .action(async (spec: string, file: string | undefined, options: { skill?: string }) => {
      const api = serverApi();
      const { record, chosen } = await chooseSkill(api, spec, options.skill, print);
      const prefix = `${chosen.path.replace(/\/+$/, "")}/`;
      const files = (await api.artifact(record.artifactId)).files.filter((item) => item.path.startsWith(prefix));
      const output = resolve(file ?? `${chosen.name}.skill`);
      writeFileSync(
        output,
        writeZip(
          files.map((item) => ({
            path: `${chosen.name}/${item.path.slice(prefix.length)}`,
            bytes: Buffer.from(item.content, "base64"),
          })),
        ),
      );
      print(
        `Exportada la skill «${chosen.name}» de ${record.name}@${record.version} en ${output} (${files.length} archivos).`,
      );
    });
}

export function registerSkillCommands(program: Command, print: Print): void {
  const skill = group(
    program,
    "skill",
    "Skills publicadas en el servidor: publicar desde un .skill o una carpeta con SKILL.md, listar y exportar",
  );
  registerSkillList(skill, print);
  registerSkillPublish(skill, print);
  registerSkillExport(skill, print);
}
