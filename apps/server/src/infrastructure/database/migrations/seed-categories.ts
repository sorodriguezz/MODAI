import type { Kysely } from "kysely";
import type { Schema } from "../schema.js";

const DEFAULT_CATEGORIES: Array<[string, string]> = [
  ["component", "Código que se copia al proyecto: módulos de backend, componentes de UI, servicios."],
  ["harness", "Instrucciones, estado, verificación y handoff para que el agente trabaje de forma fiable."],
  ["skill", "Instrucciones que el agente carga bajo demanda."],
  ["knowledge", "Documentos que el agente consulta con búsqueda."],
  ["profile", "Perfiles que componen otros paquetes."],
  ["template", "Proyectos completos para empezar con modai template use."],
  ["adapter", "Conectan MODAI con un cliente (Cursor, OpenCode…)."],
  ["agent", "Agentes listos para activar o enviar tareas."],
  ["mcp", "Herramientas y servidores MCP."],
  ["backend", "Servicios, APIs y persistencia."],
  ["frontend", "Interfaces y arquitectura de cliente."],
  ["testing", "Pruebas, regresión y calidad."],
  ["architecture", "Decisiones y patrones de arquitectura."],
  ["general", "Lo que no encaja en otra categoría."],
];

export async function seedCategories(db: Kysely<unknown>): Promise<void> {
  const now = new Date().toISOString();
  await (db as Kysely<Schema>)
    .insertInto("categories")
    .values(DEFAULT_CATEGORIES.map(([name, description]) => ({ name, description, created_at: now, updated_at: now })))
    .execute();
}
