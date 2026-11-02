# @sorodriguez/modai

Gestor de paquetes y capacidades para agentes de IA. Instala conocimiento, skills, reglas y herramientas ejecutables en tus proyectos, resuelve sus dependencias **por contrato** (`requires: browser.automation` → cualquier paquete que la proporcione), los conecta con tu agente (Agent Skills, AGENTS.md, Claude Code, Cursor, OpenCode, MCP…) y los retira sin destruir tus cambios.

No requiere servidor: un registry puede ser una carpeta local o compartida. Un servidor MODAI central es opcional (catálogo privado, memoria compartida, panel y agentes). Requiere Node `>=26.13.0 <27`. Un único paquete instala `modai` y `modai-mcp`.

```sh
npm install -g @sorodriguez/modai
cd mi-proyecto
modai init --registry ~/modai-registry --adapter agent-skills,claude-code,mcp --allow project.instructions
modai add @profiles/fullstack-quality      # compone frontend, arquitectura y regresión E2E
modai capabilities                          # qué contrato implementa cada paquete
modai grant @testing/playwright             # instalar no autoriza ejecutar: se concede por equipo
modai search "dónde ubicar el estado compartido"
```

`modai.yaml` y `modai.lock` reconstruyen exactamente el entorno en otro equipo (`modai sync --frozen` en CI). Tu agente se conecta al gateway MCP (`modai-mcp`), que expone conocimiento por fragmentos, memoria, skills como recursos y solo las herramientas autorizadas.

## Comandos principales

| Comando | Uso |
|---|---|
| `modai init` | Crea `modai.yaml` (registries, adaptadores, memoria) |
| `modai add <paquete…>` / `remove` / `update` / `outdated` / `sync [--frozen]` | Ciclo de vida reproducible y reversible |
| `modai list [tipo]` (`ls`) | Lo instalado, o con `--available`/`--registry` lo publicado: `packages`, `components`, `skills`, `tools`, `mcp`, `agents`, `rules`, `knowledge`, `profiles`, `adapters`, `capabilities`, `registries` o una categoría (`harness`, `backend`…). `--json` para scripts |
| `modai component create <dir> --name @scope/x --from <código>` | Empaqueta código propio (un módulo de backend, un componente…) como componente instalable con `modai add … --allow project.source` |
| `modai capabilities` / `providers <capacidad>` / `provider <capacidad> <paquete>` | Contratos instalados, proveedores disponibles y elección de proveedor |
| `modai grant` / `revoke` / `permissions` | Autorización local de herramientas y servidores MCP |
| `modai tools list` / `tools run <herramienta> --input '{…}'` | Herramientas de paquetes |
| `modai search` / `context show` / `remember` / `recall` | Context Gateway y memoria |
| `modai adapter list` / `adapter add <id>` | Conectar con otro agente |
| `modai registry add/list/remove/packages` | Registries del proyecto |
| `modai package scaffold` / `validate` / `keygen`, `modai publish --registry <url\|carpeta>` | Autoría y publicación |
| `modai migrate` | Convierte un proyecto 0.5 |
| `modai connect`, `whoami`, `agent …`, `worker`, `admin …` | Servidor central (opcional) |

Guías: [crear y publicar paquetes](https://github.com/sorodriguezz/MODAI/blob/main/docs/guides/AUTHORING-PACKAGES.md) · [especificación v1](https://github.com/sorodriguezz/MODAI/blob/main/docs/spec/PACKAGE-SPEC-v1.md) · [migración a 0.6](https://github.com/sorodriguezz/MODAI/blob/main/docs/guides/MIGRATION-0.6.md).

Con un servidor central: `modai connect https://modai.equipo.cl` (API key con entrada oculta) y `modai init --project ID` para compartir la memoria del equipo. Los comandos `modai agent` usan proyectos creados con `modai init --legacy`.
