import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import type { Command } from "commander";
import { ApiClient, type Role } from "@modai/sdk";
import type { PublishPackageInput } from "@modai/contracts/types";
import { skillArchiveToPackage, writeZip, type ArchiveEntry } from "@modai/core";
import { effectiveConnection } from "../connection.js";
import { group } from "../groups.js";
import type { Print } from "../output.js";
import { askText, hint, ok } from "../ui.js";

const serverApi = () => { const connection = effectiveConnection(); return new ApiClient(connection.server, connection.token); };
const list = (value: string, previous: string[] = []) => [...previous, ...value.split(",").map(item => item.trim()).filter(Boolean)];
const IGNORED = /(^|\/)(node_modules|\.git|\.DS_Store|Thumbs\.db)(\/|$)/;

function splitSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  return at > spec.indexOf("/") ? { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined } : { name: spec };
}

function folderEntries(root: string, relative = ""): ArchiveEntry[] {
  const absolute = relative ? join(root, relative) : root;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink() || (relative && IGNORED.test(relative))) return [];
  if (info.isFile()) return [{ path: relative, bytes: readFileSync(absolute) }];
  return info.isDirectory() ? readdirSync(absolute).sort().flatMap(name => folderEntries(root, relative ? posix.join(relative, name) : name)) : [];
}

/** The namespace to publish in: the given one, or the only one the credential can publish to. */
export async function resolveNamespace(api: ApiClient, namespace?: string): Promise<string> {
  if (namespace) return namespace;
  const { publish } = (await api.session()).permissions;
  if (!publish.all && publish.namespaces.length === 1) return publish.namespaces[0]!;
  throw new Error(`Indica --namespace. ${publish.all ? "Puedes publicar en cualquiera." : publish.namespaces.length ? `Puedes publicar en: ${publish.namespaces.join(", ")}.` : "Esta credencial no puede publicar en ningún namespace."}`);
}

/**
 * A skill as a package: from a `.skill`/`.zip` file or from a folder with SKILL.md (zipped in memory with the
 * folder's name, exactly like a `.skill`).
 */
export function skillSourceToPackage(source: string, options: { namespace: string; version?: string; name?: string }): PublishPackageInput & { skill: { name: string; description: string } } {
  const path = resolve(source);
  if (statSync(path).isFile()) return skillArchiveToPackage(readFileSync(path), options);
  if (!existsSync(join(path, "SKILL.md"))) throw new Error(`${path} no contiene SKILL.md`);
  const folder = basename(path);
  return skillArchiveToPackage(writeZip(folderEntries(path).map(entry => ({ path: `${folder}/${entry.path}`, bytes: entry.bytes }))), options);
}

export function registerLibraryCommands(program: Command, print: Print): void {
  // ------------------------------------------------------------------ skills
  const skill = group(program, "skill", "Skills publicadas en el servidor: publicar desde un .skill o una carpeta con SKILL.md, listar y exportar");
  skill.command("list").alias("ls").description("Paquetes del servidor que aportan skills").argument("[query]", "Filtra por texto")
    .action(async (query?: string) => print((await serverApi().catalog({ type: "skills", q: query, limit: 100 })).items.map(item => ({ name: item.name, version: item.version, description: item.description }))));
  skill.command("publish").description("Publica una skill: archivo .skill/.zip o carpeta con SKILL.md")
    .argument("<source>", "Archivo .skill o carpeta de la skill")
    .option("--namespace <@scope>", "Namespace del paquete (por defecto, el único donde puedes publicar)")
    .option("--name <name>", "Nombre de la skill (por defecto, el del frontmatter)")
    .option("--skill-version <semver>", "Versión (por defecto la del frontmatter o 1.0.0)")
    .option("--dry-run", "Muestra el paquete resultante sin publicarlo")
    .action(async (source: string, options: { namespace?: string; name?: string; skillVersion?: string; dryRun?: boolean }) => {
      const api = serverApi();
      const { skill: info, ...input } = skillSourceToPackage(source, { namespace: await resolveNamespace(api, options.namespace), version: options.skillVersion, name: options.name });
      const manifest = input.manifest as unknown as { metadata: { name: string; version: string } };
      if (options.dryRun) return print({ package: `${manifest.metadata.name}@${manifest.metadata.version}`, skill: info.name, description: info.description, files: input.files.map(file => file.path) });
      const published = await api.publish(input);
      print(`Publicada la skill «${info.name}» como ${published.name}@${published.version} (calidad ${published.quality?.score ?? "—"}/100).`);
    });
  skill.command("export").description("Descarga una skill publicada como archivo .skill (para Claude u otro agente)")
    .argument("<package>", "@scope/nombre[@versión]")
    .argument("[file]", "Archivo destino (por defecto <skill>.skill)")
    .option("--skill <name>", "Skill a exportar si el paquete aporta varias")
    .action(async (spec: string, file: string | undefined, options: { skill?: string }) => {
      const api = serverApi(), { name, version } = splitSpec(spec);
      const record = await api.getPackage(name, version);
      const skills = ((record.manifest as unknown as { spec?: { contributes?: { skills?: Array<{ name: string; path: string }> } } }).spec?.contributes?.skills ?? []);
      const chosen = options.skill ? skills.find(item => item.name === options.skill) : skills[0];
      if (!chosen) throw new Error(skills.length ? `El paquete no tiene la skill ${options.skill}. Tiene: ${skills.map(item => item.name).join(", ")}` : `${name} no aporta skills`);
      if (skills.length > 1 && !options.skill) print(`El paquete aporta ${skills.length} skills; se exporta «${chosen.name}». Usa --skill para otra.`);
      const prefix = chosen.path.replace(/\/+$/, "") + "/";
      const files = (await api.artifact(record.artifactId)).files.filter(item => item.path.startsWith(prefix));
      const output = resolve(file ?? `${chosen.name}.skill`);
      writeFileSync(output, writeZip(files.map(item => ({ path: `${chosen.name}/${item.path.slice(prefix.length)}`, bytes: Buffer.from(item.content, "base64") }))));
      print(`Exportada la skill «${chosen.name}» de ${record.name}@${record.version} en ${output} (${files.length} archivos).`);
    });

  // ------------------------------------------------------- shared knowledge
  const category = group(program, "category", "Categorías del catálogo: las que el panel ofrece al crear paquetes y templates");
  category.command("list", { isDefault: true }).alias("ls").description("Categorías registradas y las que usan paquetes sin estar registradas")
    .action(async () => print((await serverApi().categories()).map(item => ({ name: item.name, registered: item.registered, packages: item.packages, description: item.description }))));
  category.command("create").description("Registra una categoría (administración)").argument("[name]", "En minúsculas, con guiones: backend, testing… (sin él, se pregunta)")
    .option("--description <text>", "Qué tipo de paquetes van en ella")
    .action(async (name: string | undefined, options: { description?: string }) => {
      const chosen = name ?? await askText({ message: "Nombre de la categoría", flag: "<name>", example: "observabilidad", validate: value => /^[a-z][a-z0-9-]{0,63}$/.test(value) || "Minúsculas, números y guiones, empezando por letra" });
      const description = options.description ?? (name ? undefined : await askText({ message: `Descripción ${hint("(opcional)")}`, flag: "--description", default: "" }));
      const created = await serverApi().createCategory({ name: chosen, description });
      print(ok(`Categoría ${created.name} registrada.`));
    });
  category.command("update").description("Cambia la descripción de una categoría (administración)").argument("<name>").requiredOption("--description <text>")
    .action(async (name: string, options: { description: string }) => { await serverApi().updateCategory(name, { description: options.description }); print(`Categoría ${name} actualizada.`); });
  category.command("delete").alias("rm").description("Deja de ofrecer una categoría; los paquetes publicados la conservan (administración)").argument("<name>")
    .action(async (name: string) => { await serverApi().deleteCategory(name); print(`Categoría ${name} eliminada.`); });

  const knowledge = group(program, "knowledge", "Conocimiento compartido del servidor: documentos que los agentes consultan");
  knowledge.command("list").alias("ls").description("Documentos de conocimiento (manuales y de paquetes)")
    .option("--manual", "Solo los creados a mano (editables)")
    .action(async (options: { manual?: boolean }) => {
      const api = serverApi(), documents = [];
      for (let offset: number | null = 0; offset !== null;) { const page = await api.knowledgeDocuments(offset); documents.push(...page.documents); offset = page.nextOffset; }
      print(documents.filter(doc => !options.manual || !doc.packageName).map(doc => ({ id: doc.id, title: doc.title, package: doc.packageName ?? "manual" })));
    });
  knowledge.command("show").description("Muestra un documento").argument("<id>")
    .action(async (id: string) => {
      const api = serverApi();
      for (let offset: number | null = 0; offset !== null;) {
        const page = await api.knowledgeDocuments(offset);
        const found = page.documents.find(doc => doc.id === id);
        if (found) return print(found);
        offset = page.nextOffset;
      }
      throw new Error(`No existe el documento ${id}`);
    });
  knowledge.command("search").description("Busca en el conocimiento compartido").argument("<query>")
    .action(async (query: string) => print(await serverApi().searchKnowledge(query)));
  knowledge.command("add").description("Crea un documento manual (texto o archivo Markdown)")
    .requiredOption("--title <title>", "Título")
    .option("--file <path>", "Archivo con el contenido").option("--content <text>", "Contenido en línea")
    .option("--tags <tags>", "Etiquetas separadas por comas", list)
    .action(async (options: { title: string; file?: string; content?: string; tags?: string[] }) => {
      const content = options.file ? readFileSync(resolve(options.file), "utf8") : options.content;
      if (!content) throw new Error("Indica --file o --content");
      const document = await serverApi().createKnowledge({ title: options.title, content, tags: options.tags });
      print(`Documento creado: ${document.id}`);
    });
  knowledge.command("update").description("Actualiza un documento manual").argument("<id>")
    .option("--title <title>").option("--file <path>").option("--content <text>").option("--tags <tags>", "Etiquetas separadas por comas", list)
    .action(async (id: string, options: { title?: string; file?: string; content?: string; tags?: string[] }) => {
      const content = options.file ? readFileSync(resolve(options.file), "utf8") : options.content;
      await serverApi().updateKnowledge(id, { title: options.title, content, tags: options.tags });
      print(`Documento actualizado: ${id}`);
    });
  knowledge.command("remove").alias("rm").description("Elimina un documento manual").argument("<id>")
    .action(async (id: string) => { await serverApi().deleteKnowledge(id); print(`Documento eliminado: ${id}`); });

  // --------------------------------------------- users, keys and directory
  const admin = group(program, "admin", "Administración del servidor");
  admin.command("users").description("Usuarios del panel que puedes administrar")
    .action(async () => print((await serverApi().users()).map(user => ({ id: user.id, username: user.username, name: user.displayName, role: user.role, organizations: user.organizationIds.length, projects: user.projectIds.length, status: user.disabledAt ? "desactivado" : "activo" }))));
  admin.command("create-user").description("Crea un usuario del panel")
    .argument("<username>")
    .requiredOption("--password <password>", "Contraseña inicial (mín. 10 caracteres)")
    .option("--name <displayName>", "Nombre visible")
    .option("--role <role>", "reader, publisher, worker, org-admin o admin", "reader")
    .option("--organizations <ids>", "Organizaciones", list).option("--projects <ids>", "Proyectos", list).option("--scopes <namespaces>", "Namespaces", list)
    .action(async (username: string, options: { password: string; name?: string; role: Role; organizations?: string[]; projects?: string[]; scopes?: string[] }) => {
      const user = await serverApi().createUser({ username, password: options.password, displayName: options.name, role: options.role, organizationIds: options.organizations, projectIds: options.projects, packageScopes: options.scopes });
      print(`Usuario creado: ${user.username} (${user.role}, id ${user.id})`);
    });
  admin.command("update-user").description("Cambia rol, accesos o estado de un usuario (las listas reemplazan las actuales)")
    .argument("<id>")
    .option("--name <displayName>").option("--role <role>")
    .option("--organizations <ids>", "Organizaciones", list).option("--projects <ids>", "Proyectos", list).option("--scopes <namespaces>", "Namespaces", list)
    .option("--disable", "Desactiva la cuenta y cierra sus sesiones").option("--enable", "Reactiva la cuenta")
    .option("--password <password>", "Restablece la contraseña")
    .action(async (id: string, options: { name?: string; role?: Role; organizations?: string[]; projects?: string[]; scopes?: string[]; disable?: boolean; enable?: boolean; password?: string }) => {
      const user = await serverApi().updateUser(id, { displayName: options.name, role: options.role, organizationIds: options.organizations, projectIds: options.projects, packageScopes: options.scopes, password: options.password, ...(options.disable ? { disabled: true } : options.enable ? { disabled: false } : {}) });
      print(`Usuario actualizado: ${user.username} (${user.role}${user.disabledAt ? ", desactivado" : ""})`);
    });
  admin.command("delete-user").description("Elimina un usuario").argument("<id>")
    .action(async (id: string) => { await serverApi().deleteUser(id); print(`Usuario eliminado: ${id}`); });
  admin.command("keys").description("API keys que puedes administrar")
    .option("--all", "Incluye las revocadas")
    .action(async (options: { all?: boolean }) => print((await serverApi().apiKeys()).filter(key => options.all || !key.revokedAt).map(key => ({ id: key.id, label: key.label, role: key.role, lastUsed: key.lastUsedAt ?? "nunca", status: key.revokedAt ? "revocada" : "activa" }))));
  admin.command("revoke-key").description("Revoca una API key").argument("<id>")
    .action(async (id: string) => { await serverApi().revokeApiKey(id); print(`API key revocada: ${id}`); });
  admin.command("update-organization").description("Renombra o describe una organización").argument("<id>")
    .option("--name <name>").option("--description <text>")
    .action(async (id: string, options: { name?: string; description?: string }) => print(await serverApi().updateOrganization(id, options)));
  admin.command("delete-organization").description("Elimina una organización vacía").argument("<id>")
    .requiredOption("--confirm <name>", "Nombre exacto de la organización")
    .action(async (id: string, options: { confirm: string }) => { await serverApi().deleteOrganization(id, options.confirm); print(`Organización eliminada: ${options.confirm}`); });
  admin.command("update-namespace").description("Cambia organización, visibilidad o descripción de un namespace").argument("<name>")
    .option("--organization <id>", "Organización dueña (\"none\" para quitarla)").option("--restricted", "Solo quien lo tenga asignado ve sus paquetes").option("--internal", "Cualquier identidad autenticada ve sus paquetes").option("--description <text>")
    .action(async (name: string, options: { organization?: string; restricted?: boolean; internal?: boolean; description?: string }) =>
      print(await serverApi().updateNamespace(name, { ...(options.organization ? { organizationId: options.organization === "none" ? null : options.organization } : {}), ...(options.restricted ? { visibility: "restricted" } : options.internal ? { visibility: "internal" } : {}), ...(options.description !== undefined ? { description: options.description } : {}) })));
  admin.command("delete-namespace").description("Elimina un namespace sin paquetes").argument("<name>")
    .action(async (name: string) => { await serverApi().deleteNamespace(name); print(`Namespace eliminado: ${name}`); });
  admin.command("audit").description("Últimos eventos de auditoría").option("--limit <n>", "Cantidad", "50")
    .action(async (options: { limit: string }) => print((await serverApi().audit(Number(options.limit))).map(event => ({ when: event.createdAt, actor: event.actor, action: event.action, resource: event.resource }))));
}
