# MODAI CLI

[![npm](https://img.shields.io/npm/v/@sorodriguez/modai)](https://www.npmjs.com/package/@sorodriguez/modai)
![node](https://img.shields.io/badge/node-%3E%3D26.13-339933)

**Gestor de paquetes para agentes de IA.** Instala en tus proyectos lo que tu agente necesita para trabajar bien (skills, reglas, conocimiento, herramientas, harnesses) y también **código reutilizable de tu equipo**, como módulos de backend o componentes de UI. Lo conecta con Claude Code, Cursor, OpenCode o cualquier cliente MCP, y lo retira sin perder tus cambios.

```bash
npm install -g @sorodriguez/modai
```

Instala dos comandos: `modai` (la CLI) y `modai-mcp` (el servidor MCP al que se conecta tu agente). No necesita servidor: un registry puede ser una carpeta local o compartida. El [servidor MODAI](https://github.com/sorodriguezz/MODAI/tree/main/apps/server) es opcional y suma un catálogo privado, un panel web y memoria compartida para tu equipo.

## Qué trae

| | |
|---|---|
| **Componentes de código** | Empaqueta un módulo que ya escribiste y reutilízalo en otros proyectos con `modai add`. |
| **Skills, reglas y conocimiento** | Instrucciones y documentación que el agente carga solo cuando las necesita. |
| **Harnesses** | `AGENTS.md`, progreso, verificación y handoff para que el agente trabaje de forma ordenada entre sesiones. |
| **Herramientas** | Comandos ejecutables que el agente invoca por MCP, solo después de que tú los autorizas. |
| **Adaptadores** | Un mismo paquete funciona en Claude Code, Cursor, OpenCode, `AGENTS.md` o cualquier cliente MCP. |
| **Memoria** | Decisiones y notas del proyecto que el agente recuerda, locales o compartidas con el equipo. |
| **Reproducible y reversible** | `modai.yaml` + `modai.lock` reconstruyen lo mismo en otro equipo o en CI; `modai remove` conserva lo que editaste. |

## Ejemplo: reutilizar tu módulo de autenticación en otro proyecto

**1. Empaqueta el código** que ya tienes en un proyecto:

```console
$ cd api
$ modai component create ../auth-module --name @acme/auth --from src/modules/auth --language nestjs \
    --description "Autenticación JWT para NestJS"
Componente creado en ../auth-module
Valida:   modai package validate ../auth-module
Publica:  modai publish ../auth-module --registry <registry>
Instala:  modai add @acme/auth --allow project.source
```

**2. Publícalo** en un registry: una carpeta, que puede ser compartida, o tu servidor MODAI.

```console
$ modai publish ../auth-module --registry ~/.modai/registry
Publicado @acme/auth@0.1.0 en file:~/.modai/registry (sha256-e861…)
```

**3. Instálalo** en otro proyecto:

```console
$ cd ../shop
$ modai init --adapter agents-md,claude-code,mcp --allow project.instructions
Proyecto MODAI inicializado en ../shop
Adaptadores: agents-md, claude-code, mcp

$ modai add @acme/auth --allow project.source
Añadido @acme/auth.
1 paquete(s) instalados: @acme/auth@0.1.0.
Escritos: src/ (2), AGENTS.md, CLAUDE.md

$ modai list components
COMPONENT  PACKAGE     VERSION  TARGET            LANGUAGE  DESCRIPTION
auth       @acme/auth  0.1.0    src/modules/auth  nestjs    Autenticación JWT para NestJS
```

El código queda en `src/modules/auth/` y es tuyo: puedes modificarlo. `AGENTS.md` y `CLAUDE.md` le indican al agente qué se instaló, y `.mcp.json` lo conecta con `modai-mcp`. Si después ejecutas `modai remove @acme/auth`, MODAI borra solo los archivos que no tocaste y te avisa de los que conservó.

## Uso diario

```bash
modai list                        # qué hay instalado
modai list harness --available    # qué harnesses hay publicados
modai list skills                 # también: components, tools, agents, rules, knowledge, profiles…
modai add @equipo/harness @equipo/nestjs-skills
modai update                      # actualiza dentro de los rangos de modai.yaml
modai outdated                    # qué tiene versiones nuevas
modai remove @equipo/harness
modai sync --frozen               # en CI: reconstruye exactamente modai.lock
```

**Instalar no es autorizar.** Los permisos para escribir archivos se conceden al instalar (`--allow`). Las herramientas que ejecutan comandos necesitan una autorización explícita, válida solo en tu equipo y solo para ese contenido exacto:

```bash
modai grant @testing/regression        # muestra comandos y permisos y pide confirmación
modai tools run regression_baseline --input '{"mode":"compare","results":{"tests":[]}}'
```

**Contexto para el agente**, sin cargar todo en el prompt:

```bash
modai search "dónde ubicar el estado compartido"   # fragmentos de conocimiento con su origen
modai remember "Usamos Playwright contra staging" --kind decision
modai recall "staging"
```

## Conectar tu agente

Según los adaptadores activos, `modai init` y `modai add` escriben la configuración de cada agente:

| Adaptador | Qué escribe |
|---|---|
| `claude-code` | `.claude/skills/`, `CLAUDE.md` y `.mcp.json` |
| `agents-md` | Un bloque con reglas e índice en `AGENTS.md` |
| `agent-skills` | `.agents/skills/` (formato abierto de Agent Skills) |
| `mcp` | `.modai/mcp.json` para cualquier cliente MCP |
| Cursor, OpenCode… | Paquetes `kind: Adapter`: `modai add @adapters/cursor` y luego `modai adapter add cursor` |

Para cualquier otro cliente MCP, el servidor es `modai-mcp --project <ruta-del-proyecto>`.

## Crear y publicar tus paquetes

```bash
modai package scaffold ./mi-skill --name @equipo/mi-skill --category backend   # skill, reglas y conocimiento
modai package scaffold ./mi-tool --name @equipo/mi-tool --with-tool            # con una herramienta ejecutable
modai component create ./mi-modulo --name @equipo/mi-modulo --from ./src/modules/x
modai harness init                                                              # harness en el proyecto actual
modai package validate ./mi-skill                                               # calidad estructural 0-100
modai publish ./mi-skill --registry ~/.modai/registry                           # o la URL de tu servidor
```

También puedes crear y versionar paquetes desde el **panel web** del servidor (Paquetes → Crear paquete). Las versiones publicadas son inmutables. Referencia del formato: [especificación de paquetes v1](https://github.com/sorodriguezz/MODAI/blob/main/docs/spec/PACKAGE-SPEC-v1.md) y [guía de autoría](https://github.com/sorodriguezz/MODAI/blob/main/docs/guides/AUTHORING-PACKAGES.md).

## Trabajar en equipo con un servidor

```bash
modai connect https://modai.tu-equipo.cl     # pide tu API key (créala en el panel → Conectar un cliente)
modai init --project <id>                    # usa el servidor como registry y comparte la memoria del proyecto
```

## Referencia de comandos

| Para… | Comandos |
|---|---|
| Proyecto | `init`, `add`, `remove`, `update`, `outdated`, `sync [--frozen]`, `status`, `override` |
| Listar | `list [tipo] [--available] [--json]` (`ls`), `capabilities`, `providers <capacidad>`, `registry list` |
| Componentes | `component create`, `component list` |
| Permisos y herramientas | `grant`, `revoke`, `permissions`, `tools list`, `tools run` |
| Contexto y memoria | `search`, `context show`, `remember`, `recall`, `memories`, `forget` |
| Agentes | `adapter list/add/remove`, `harness init/audit`, `agent …`, `worker` |
| Autoría | `package scaffold/validate/keygen`, `publish`, `deprecate`, `yank`, `unpublish` |
| Servidor | `connect`, `whoami`, `project list`, `admin …` |
| La propia CLI | `upgrade [--check] [--tag next]`, `--version` |

`modai <comando> --help` muestra las opciones de cada uno.

## Actualizar

```bash
modai upgrade            # instala la última versión con el gestor que usaste (npm, pnpm, yarn o bun)
modai upgrade --check    # solo avisa si hay una versión nueva
```

Una vez al día, la CLI avisa si hay una versión nueva. Puedes desactivar el aviso con `MODAI_NO_UPDATE_NOTIFIER=1`, y nunca aparece en CI.

## Requisitos

- Node.js `>=26.13.0 <27`.
- Opcional: [Ollama](https://ollama.com) para búsqueda semántica con embeddings locales (`modai client`, `modai embed`).

[Repositorio](https://github.com/sorodriguezz/MODAI) · [Cambios](https://github.com/sorodriguezz/MODAI/blob/main/CHANGELOG.md) · [Reportar un problema](https://github.com/sorodriguezz/MODAI/issues)
