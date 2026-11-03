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

## Muchos repositorios a la vez

Desde una carpeta con varios repositorios (o un monorepo), `modai workspace` aplica la misma operación en todos los proyectos MODAI que encuentra:

```console
$ modai workspace add @equipo/harness --root ~/code --dry-run
Añadir @equipo/harness en ~/code:
PROJECT      RESULT       DETAIL
api          pendiente    añadirá @equipo/harness
billing      sin cambios  ya está instalado
legacy-app   omitido      formato 0.5: conviértelo con modai migrate
web          pendiente    añadirá @equipo/harness

$ modai workspace add @equipo/harness --root ~/code --allow project.instructions
```

- Primero muestra el plan y pide confirmación (`--yes` en scripts; `--dry-run` no cambia nada).
- Aplica un proyecto a la vez, con un bloqueo por proyecto, y nunca deja uno a medias: `modai.yaml` solo cambia si su sincronización termina bien.
- Si uno falla, sigue con los demás (o se detiene con `--fail-fast`) y al final informa cada resultado. Repetir el comando es seguro: lo ya hecho aparece "sin cambios".
- No sigue enlaces simbólicos, ignora `node_modules`, `.git`, `dist`… y limita la profundidad (`--depth`, 4 por defecto). `--filter api,web` restringe por ruta. Ctrl+C termina el proyecto en curso y se detiene.

También: `modai workspace list`, `remove <paquete>`, `update [paquetes] [--keep-mine]` y `sync [--frozen]`.

## Si editaste archivos instalados

Los componentes y archivos que instala MODAI son tuyos: puedes modificarlos. Cuando sale una versión nueva y tú cambiaste un archivo, `modai update` se detiene y te deja elegir:

```bash
modai update --keep-mine   # conserva tu archivo y deja la versión nueva al lado: auth.service.ts.modai-new
modai update --force       # reemplaza tu archivo por la versión nueva
```

Con `--keep-mine` la decisión queda registrada en `modai.lock`: los `sync` siguientes no vuelven a preguntar hasta que haya otra versión. `modai remove` nunca borra un archivo que modificaste.

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

```console
$ modai ping https://modai.tu-equipo.cl
   CHECK       DETAIL
✓  Servidor    https://modai.tu-equipo.cl · ok · 42 ms
✓  Versión     servidor 0.8.0 · CLI 0.8.0
!  Credencial  no hay API key guardada para este servidor: modai connect https://modai.tu-equipo.cl
```

```bash
modai connect https://modai.tu-equipo.cl     # pide tu API key (créala en el panel → Conectar un cliente)
modai init --project <id>                    # usa el servidor como registry y comparte la memoria del proyecto
```

Para cambiar de servidor, `modai logout` borra el servidor y la API key guardados (conserva tus publicadores de confianza) y luego `modai connect <otra-url>`.

Dentro de un proyecto, `modai ping` revisa también sus registries. Sale con código 1 si el servidor no responde, así que sirve en scripts. Los proyectos vinculados informan al servidor qué tienen instalado, y el panel muestra qué proyectos usan cada paquete (desactívalo con `MODAI_NO_USAGE_REPORT=1`).

Con un proyecto vinculado también puedes usar **agentes** compuestos por el servidor: `modai agent list`, `agent activate <paquete>`, `agent run "<tarea>"` y `agent submit` para que lo procese un `modai worker`.

## Referencia de comandos

| Para… | Comandos |
|---|---|
| Proyecto | `init`, `add`, `remove`, `update [--keep-mine]`, `outdated`, `sync [--frozen]`, `status`, `override` |
| Muchos repositorios | `workspace list/add/remove/update/sync` (`ws`) |
| Listar | `list [tipo] [--available] [--json]` (`ls`), `capabilities`, `providers <capacidad>`, `registry list` |
| Componentes | `component create`, `component list` |
| Permisos y herramientas | `grant`, `revoke`, `permissions`, `tools list`, `tools run` |
| Contexto y memoria | `search`, `context show`, `remember`, `recall`, `memories`, `forget` |
| Agentes | `adapter list/add/remove`, `harness init/audit`, `agent …`, `worker` |
| Autoría | `package scaffold/validate/keygen`, `publish`, `deprecate`, `yank`, `unpublish` |
| Servidor | `ping`, `connect`, `logout`, `whoami`, `project list`, `admin …` |
| La propia CLI | `upgrade [--check] [--tag next]`, `--version` |

`modai <comando> --help` muestra las opciones de cada uno. Todas las salidas son tablas legibles; añade `--json` a cualquier comando para usarlo en scripts.

Los proyectos del formato 0.5 (`.modai/manifest.yaml`) se convierten una vez con `modai migrate`.

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
