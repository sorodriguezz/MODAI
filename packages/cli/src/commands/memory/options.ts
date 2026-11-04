export type MemoryOptions = { project?: string; kind?: string; scope?: string };

export const PROJECT_OPTION = [
  "--project <id>",
  "Proyecto del servidor (sin modai.yaml); por defecto, el del proyecto actual",
] as const;
