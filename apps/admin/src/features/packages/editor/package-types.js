export const MAX_BYTES = 25 * 1024 * 1024;
export const IGNORED = /(^|\/)(node_modules|\.git|dist|\.DS_Store|Thumbs\.db)(\/|$)/;
export const slug = (value, fallback = "item") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || fallback;

export const TEMPLATES = {
  component: {
    label: "Componente de código",
    icon: "code",
    category: "component",
    root: "component",
    text: "Módulos de backend, componentes de UI, servicios… Se copian al proyecto y el usuario puede adaptarlos.",
    starter: (s) => ({
      "component/README.md": `# ${s.component.name || "mi-componente"}\n\nQué resuelve este componente, cómo se integra y qué dependencias espera.\n`,
      "component/index.ts": `// Punto de entrada de ${s.component.name || "mi-componente"}.\nexport {};\n`,
    }),
  },
  harness: {
    label: "Harness",
    icon: "layers",
    category: "harness",
    root: "harness",
    text: "Instrucciones, estado, verificación y handoff para que el agente trabaje de forma fiable.",
    starter: () => ({
      "harness/AGENTS.md":
        "# Instrucciones del agente\n\n## Inicio\n\n1. Lee `.agent/progress.md`.\n2. Trabaja en una sola función a la vez (WIP=1).\n\n## Cierre\n\nRegistra la evidencia en `.agent/verification.md` y actualiza el handoff.\n",
      "harness/.agent/progress.md":
        "# Progreso\n\n## Estado verificado actual\n\n- Función activa: ninguna\n\n## Próxima acción\n\nPendiente.\n",
      "harness/.agent/verification.md":
        "# Verificación\n\n## Gates ejecutables\n\n- `npm test`\n\n## Definition of Done\n\n- El comportamiento tiene evidencia reproducible.\n",
      "harness/.agent/session-handoff.md":
        "# Entrega de sesión\n\n## Verificado ahora\n\nPendiente.\n\n## Mejor próximo paso\n\nPendiente.\n",
      "harness/.agent/feature_list.json": `${JSON.stringify({ schemaVersion: 1, wipLimit: 1, features: [] }, null, 2)}\n`,
    }),
  },
  skill: {
    label: "Skill",
    icon: "spark",
    category: "skill",
    root: "skills",
    text: "Instrucciones que el agente carga bajo demanda (SKILL.md y referencias).",
    starter: (s) => ({
      [`skills/${s.skill}/SKILL.md`]: `---\nname: ${s.skill}\ndescription: Explica qué logra esta skill, cuándo debe activarse y qué queda fuera de su alcance.\n---\n\n# ${s.skill}\n\n## Flujo\n\n1. Inspecciona el contexto relevante.\n2. Ejecuta el trabajo manteniendo el alcance solicitado.\n3. Verifica el resultado con evidencia observable.\n`,
    }),
  },
  knowledge: {
    label: "Conocimiento",
    icon: "book",
    category: "knowledge",
    root: "knowledge",
    text: "Documentos que el agente consulta con búsqueda, sin cargarlos completos en el prompt.",
    starter: () => ({ "knowledge/README.md": "# Guía\n\nConocimiento que el agente recupera bajo demanda.\n" }),
  },
  profile: {
    label: "Perfil",
    icon: "user",
    category: "profile",
    kind: "Profile",
    root: "",
    text: "Compone otros paquetes (skills, harness, conocimiento…) en un conjunto que se instala de una vez. Sin archivos propios.",
    starter: () => ({}),
  },
  template: {
    label: "Template de proyecto",
    icon: "copy",
    category: "template",
    kind: "Template",
    root: "",
    text: "Un proyecto completo para empezar (por ejemplo NestJS con SDD), con opciones como --sdd. Se usa con modai template use.",
    starter: () => ({}),
  },
  blank: {
    label: "Paquete vacío",
    icon: "package",
    category: "general",
    root: "",
    text: "Edita el manifiesto a mano: perfiles, herramientas, adaptadores…",
    starter: () => ({}),
  },
};
