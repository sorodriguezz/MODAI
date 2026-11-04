# MODAI CLI

[![npm](https://img.shields.io/npm/v/@sorodriguez/modai)](https://www.npmjs.com/package/@sorodriguez/modai)
![node](https://img.shields.io/badge/node-%3E%3D26.13-339933)

**Gestor de paquetes para agentes de IA.** Instala en tus proyectos lo que tu agente necesita para trabajar bien (skills, reglas, conocimiento, herramientas, harnesses) y también **código reutilizable de tu equipo**, como módulos de backend o componentes de UI. Lo conecta con Claude Code, Cursor, OpenCode o cualquier cliente MCP, y lo retira sin perder tus cambios.

```bash
npm install -g @sorodriguez/modai
```

Instala dos comandos: `modai` (la CLI) y `modai-mcp` (el servidor MCP al que se conecta tu agente). No necesita servidor: un registry puede ser una carpeta local o compartida. El [servidor MODAI](https://github.com/sorodriguezz/MODAI/blob/main/apps/server/README.md) es opcional y suma un catálogo privado, un panel web y memoria compartida para tu equipo.

## Contenido

- [Qué trae](#qué-trae)
- [Ejemplo: reutilizar tu módulo de autenticación](#ejemplo-reutilizar-tu-módulo-de-autenticación-en-otro-proyecto)
- [Uso diario](#uso-diario)
- [Features: paquetes por partes](#features-paquetes-por-partes)
- [Templates de proyecto](#templates-de-proyecto)
- [Muchos repositorios a la vez](#muchos-repositorios-a-la-vez)
- [Si editaste archivos instalados](#si-editaste-archivos-instalados)
- [Conectar tu agente](#conectar-tu-agente)
- [Servidor MCP](#servidor-mcp)
- [Crear y publicar tus paquetes](#crear-y-publicar-tus-paquetes)
- [Trabajar en equipo con un servidor](#trabajar-en-equipo-con-un-servidor)
- [Administrar el servidor desde la CLI](#administrar-el-servidor-desde-la-cli)
- [Agentes y workers](#agentes-y-workers)
- [Harness engineering](#harness-engineering)
- [Modelos locales y búsqueda semántica](#modelos-locales-y-búsqueda-semántica)
- [Referencia de comandos](#referencia-de-comandos)
- [Actualizar](#actualizar)
- [Requisitos](#requisitos)

## Qué trae

|                                   |                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Componentes de código**         | Empaqueta un módulo que ya escribiste y reutilízalo en otros proyectos con `modai add`.                            |
| **Skills, reglas y conocimiento** | Instrucciones y documentación que el agente carga solo cuando las necesita.                                        |
| **Harnesses**                     | `AGENTS.md`, progreso, verificación y handoff para que el agente trabaje de forma ordenada entre sesiones.         |
| **Herramientas**                  | Comandos ejecutables que el agente invoca por MCP, solo después de que tú los autorizas.                           |
| **Templates**                     | Proyectos completos para empezar, armados por capas con flags (`--sdd`, `--metrics`).                              |
| **Adaptadores**                   | Un mismo paquete funciona en Claude Code, Cursor, OpenCode, `AGENTS.md` o cualquier cliente MCP.                   |
| **Memoria**                       | Decisiones y notas del proyecto que el agente recuerda, locales o compartidas con el equipo.                       |
| **Reproducible y reversible**     | `modai.yaml` + `modai.lock` reconstruyen lo mismo en otro equipo o en CI; `modai remove` conserva lo que editaste. |

## Ejemplo: reutilizar tu módulo de autenticación en otro proyecto

**1. Empaqueta el código** que ya tienes en un proyecto:

```console
$ cd api
$ modai component create ../auth-module --name @acme/auth --from src/modules/auth --language nestjs \
    --description "Autenticación JWT para NestJS"
Componente creado en ../auth-module
Valida:   modai package validate ../auth-module
Publica:  modai package publish ../auth-module --registry <registry>
Instala:  modai add @acme/auth --allow project.source
```

**2. Publícalo** en un registry: una carpeta, que puede ser compartida, o tu servidor MODAI.

```console
$ modai package publish ../auth-module --registry ~/.modai/registry
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
modai list skills                 # también: components, tools, agents, rules, knowledge, profiles, templates…
modai add @equipo/harness @equipo/nestjs-skills
modai update                      # actualiza dentro de los rangos de modai.yaml
modai outdated                    # qué tiene versiones nuevas
modai remove @equipo/harness
modai sync --frozen               # en CI: reconstruye exactamente modai.lock
```

**Instalar no es autorizar.** Los permisos para escribir archivos se conceden al instalar (`--allow project.instructions`, `project.files`, `project.source`). Las herramientas que ejecutan comandos necesitan una autorización explícita, válida solo en tu equipo y solo para ese contenido exacto; si el contenido cambia, `modai sync` avisa que hay que volver a autorizar:

```bash
modai permissions grant @testing/regression        # muestra comandos y permisos y pide confirmación
modai capability run regression_baseline --input '{"mode":"compare","results":{"tests":[]}}'
```

**Capacidades.** Los paquetes dependen de contratos (`browser.automation`), no de herramientas concretas. Si falta un proveedor, `modai add` falla con `CAPABILITY_UNSATISFIED` y sugiere qué paquete añadir:

```bash
modai capability list                                    # contratos, proveedores, herramientas y skills
modai capability providers browser.automation            # quién la proporciona en los registries
modai capability use browser.automation @testing/playwright
```

**Contexto para el agente**, sin cargar todo en el prompt:

```bash
modai context search "dónde ubicar el estado compartido"   # fragmentos de conocimiento con su origen
modai memory add "Usamos Playwright contra staging" --kind decision
modai memory search "staging"
```

## Features: paquetes por partes

Un paquete puede declarar partes opcionales (`spec.features`) que eliges con flags al instalar. La elección queda en `modai.yaml`, así `sync` y `update` la reproducen en cualquier equipo.

```bash
modai add @components/health-module --help                  # qué opciones declara
modai add @components/health-module --nestjs --metrics --allow project.source
modai add @eq/health --tls @eq/auth --jwt --no-sessions     # cada flag se aplica al paquete escrito antes
modai feature list                                          # qué está activo en el proyecto
modai feature disable @components/health-module metrics
modai feature reset @components/health-module
```

Activar o quitar una feature instala o retira sus archivos y dependencias (los que editaste se conservan) y deja el paquete sin autorizar hasta repetir `modai permissions grant`. El formato está en la [especificación de paquetes](https://github.com/sorodriguezz/MODAI/blob/main/packages/contracts/README.md#features-specfeatures).

## Templates de proyecto

Un template es un paquete `kind: Template` con un proyecto completo para empezar (por ejemplo NestJS con SDD). Se publica y versiona como cualquier paquete, pero no se instala: `modai add` falla con `TEMPLATE_NOT_INSTALLABLE`.

```bash
modai template list
modai template use @plantillas/nestjs-sdd ./mi-servicio --var owner=equipo-pagos
modai template use @eq/springboot ./api --sdd --x-lib --no-lombok --with @eq/sdd-addon
modai template use @eq/springboot --help           # las opciones que declara ese template
modai template info @plantillas/nestjs-sdd
modai template download @plantillas/nestjs-sdd mi-plantilla.zip
```

`use` crea la carpeta (si no está vacía exige `--force`) y reemplaza los marcadores `{{clave}}` en rutas y archivos de texto; `{{projectName}}` es el nombre de la carpeta. `--dry-run` muestra lo que se crearía y `--sync` instala en el mismo paso los paquetes que añaden las features (con `--allow project.source` si traen código). Verifica hashes y firma igual que `modai add`.

**Crear un template:**

```bash
modai template init ./nestjs-sdd
modai feature define ./nestjs-sdd sdd --description "Spec-Driven Development" --path features/sdd --package @methodologies/sdd@^1
modai template publish ./nestjs-sdd --name @plantillas/nestjs-sdd@1.0.0 \
  --description "API NestJS con SDD, pruebas y CI" --category backend --tags nestjs,postgres,sdd
```

Las opciones viven en `modai.template.yaml`, en la raíz del template (no se copia al proyecto):

```yaml
features:
  sdd:
    description: Spec-Driven Development
    path: features/sdd # archivos que se superponen al proyecto
    vars: { specsDir: specs } # valor por defecto de {{specsDir}}
    uses: "@eq/sdd-addon@1.0.0" # add-on que se aplica antes de la carpeta
    packages: # se añaden al modai.yaml del proyecto nuevo
      "@methodologies/sdd": "^1"
      "@components/health-module": { version: "^1.1", features: [nestjs, metrics] }
  lombok:
    description: Lombok
    path: features/lombok
    default: true
    conflicts: [legacy]
addon: { for: ["@eq/springboot"] } # solo si este template es una capa para otros
```

Las capas se aplican en orden: base, cada feature activa (su add-on y luego su carpeta) y por último los `--with`; un archivo posterior reemplaza al anterior. Nunca se publican `node_modules`, `.git`, `dist`, `build`, `coverage` ni `.env` (sí `.env.example`); el máximo es 25 MiB. Las reglas de nombres, `default`, `requires` y `conflicts` son las de las features de paquetes. En el panel: **Paquetes → Crear paquete → Template de proyecto**.

## Muchos repositorios a la vez

Desde una carpeta con varios repositorios (o un monorepo), `modai workspace` aplica la misma operación en todos los proyectos MODAI que encuentra:

```console
$ modai workspace add @equipo/harness --root ~/code --dry-run
Añadir @equipo/harness en ~/code:
PROJECT      RESULT       DETAIL
api          pendiente    añadirá @equipo/harness
billing      sin cambios  ya está instalado
web          pendiente    añadirá @equipo/harness

$ modai workspace add @equipo/harness --root ~/code --allow project.instructions
```

- Primero muestra el plan y pide confirmación (`--yes` en scripts; `--dry-run` no cambia nada).
- Aplica un proyecto a la vez, con un bloqueo por proyecto, y nunca deja uno a medias: `modai.yaml` solo cambia si su sincronización termina bien.
- Si uno falla, sigue con los demás (o se detiene con `--fail-fast`) y al final informa cada resultado. Repetir el comando es seguro: lo ya hecho aparece "sin cambios".
- No sigue enlaces simbólicos, ignora `node_modules`, `.git`, `dist`… y limita la profundidad (`--depth`, 4 por defecto). `--filter api,web` restringe por ruta. Ctrl+C termina el proyecto en curso y se detiene.

También: `modai workspace list`, `remove <paquete>`, `update [paquetes] [--keep-mine]` y `sync [--frozen]`.

## Si editaste archivos instalados

Los componentes y archivos que instala MODAI son tuyos: puedes modificarlos. Cuando sale una versión nueva y tú cambiaste un archivo, `modai update` se detiene con `MANAGED_CONFLICT` y te deja elegir:

```bash
modai update --keep-mine   # conserva tu archivo y deja la versión nueva al lado: auth.service.ts.modai-new
modai update --force       # reemplaza tu archivo por la versión nueva
```

Con `--keep-mine` la decisión queda registrada en `modai.lock`: los `sync` siguientes no vuelven a preguntar hasta que haya otra versión. `modai remove` nunca borra un archivo que modificaste.

## Conectar tu agente

Según los adaptadores activos, `modai init` y `modai add` escriben la configuración de cada agente:

| Adaptador         | Qué escribe                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `claude-code`     | `.claude/skills/`, `CLAUDE.md` y `.mcp.json`                                              |
| `agents-md`       | Un bloque con reglas e índice en `AGENTS.md`                                              |
| `agent-skills`    | `.agents/skills/` (formato abierto de Agent Skills)                                       |
| `mcp`             | `.modai/mcp.json` para cualquier cliente MCP                                              |
| Cursor, OpenCode… | Paquetes `kind: Adapter`: `modai add @adapters/cursor` y luego `modai adapter add cursor` |

Cambiar de agente es cambiar `adapters` en `modai.yaml` (`modai adapter add/remove`): el conocimiento, las skills y las herramientas no se reinstalan.

## Servidor MCP

`modai-mcp --project <ruta>` es un servidor MCP por stdio. Funciona **sin servidor MODAI**: lee `modai.lock`, el store verificado y el índice local. Los adaptadores escriben su configuración; para otro cliente:

```json
{
  "mcpServers": {
    "modai": { "command": "modai-mcp", "args": ["--project", "/ruta/absoluta/mi-proyecto"] }
  }
}
```

| Herramienta / recurso                 | Descripción                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `modai_search_knowledge`              | Fragmentos de conocimiento con paquete, versión y ruta; filtros `packages` y `limit`            |
| `modai_read_knowledge`                | Texto completo de un fragmento por id                                                           |
| `modai_list_capabilities`             | Contratos instalados, proveedor elegido, skills y estado de autorización de herramientas        |
| `modai_project_status`                | Dependencias y versiones fijadas                                                                |
| `modai_recall`, `modai_remember`      | Memoria local o remota según `context.memory`                                                   |
| herramientas de paquetes              | Solo las autorizadas con `modai permissions grant` y cuya copia local coincide con `modai.lock` |
| `<servidor>__<herramienta>`           | Herramientas de `mcpServers` de paquetes autorizados, a través del gateway                      |
| `modai://skills/<nombre>[/<archivo>]` | Skills instaladas como recursos                                                                 |

Con un agente activo (`.modai/activation.json`), las herramientas de conocimiento y memoria se sustituyen por las que el agente seleccionó, y se exponen el recurso `modai://agent/active` y el prompt `modai_agent` (argumento `task`). Reinicia el proceso después de activar o cambiar el agente. Los resultados de herramientas son datos: nunca amplían permisos. Con memoria remota, los roles de la API key siguen aplicándose (`modai_remember` requiere poder escribir memoria).

## Crear y publicar tus paquetes

```bash
modai package scaffold ./mi-skill --name @equipo/mi-skill --category backend   # skill, reglas y conocimiento
modai package scaffold ./mi-tool --name @equipo/mi-tool --with-tool            # con una herramienta ejecutable
modai component create ./mi-modulo --name @equipo/mi-modulo --from ./src/modules/x
modai package validate ./mi-skill                                               # calidad estructural 0-100
modai package publish ./mi-skill --registry ~/.modai/registry                   # o la URL de tu servidor
modai package keygen                                                            # par Ed25519; firma con --key
modai add file:../mi-skill                                                      # instalar sin publicar
modai feature define ./mi-modulo nestjs --description "Módulo NestJS" --path features/nestjs
```

`modai feature define <carpeta> <nombre>` sirve para un paquete (escribe `spec.features` en `modai.package.yaml`) y para un template (escribe `modai.template.yaml`): `--path` es la carpeta con sus archivos, `--requires`/`--conflicts` las relaciones con otras opciones, `--package @x/y@^1` lo que instala, y en templates también `--var clave=valor` y `--uses`. `modai feature undefine` la quita.

Skills sueltas: `modai skill publish ./code-review --namespace @skills` acepta un `.skill`, un `.zip` o una carpeta con `SKILL.md`; `modai skill export @skills/code-review` la descarga como `.skill`.

Las versiones publicadas son inmutables. También puedes crear y versionar paquetes desde el panel web (**Paquetes → Crear paquete**). Formato completo: [especificación de paquetes v1](https://github.com/sorodriguezz/MODAI/blob/main/packages/contracts/README.md).

## Trabajar en equipo con un servidor

```console
$ modai server ping https://modai.tu-equipo.cl
   CHECK       DETAIL
✓  Servidor    https://modai.tu-equipo.cl · ok · 42 ms
✓  Versión     servidor 0.8.0 · CLI 0.8.0
!  Credencial  no hay API key guardada para este servidor: modai server connect https://modai.tu-equipo.cl
```

```bash
modai server connect https://modai.tu-equipo.cl     # pide tu API key (créala en el panel → Conectar un cliente)
modai server whoami                                 # rol, proyectos, namespaces y qué puedes hacer
modai init --project <id>                           # el servidor pasa a ser registry y memoria compartida
```

`connect` guarda la conexión en `~/.modai/client.yaml`, con permisos restringidos y fuera del repositorio; en automatizaciones usa `--token-stdin` o `MODAI_API_TOKEN`. Si el repositorio ya tiene `modai.yaml` y `modai.lock`, usa `modai sync` en vez de `init`.

**Credenciales.** La API key solo viaja al servidor al que pertenece: la guardada, al servidor con que la guardaste; `MODAI_API_TOKEN`, a `MODAI_SERVER` (o al servidor configurado). Un `modai.yaml` o un template que apunte a otro registry no la recibe, así que en CI define **ambas** variables. Tampoco se envía por `http://` salvo a `localhost`; en una red de confianza puedes permitirlo con `MODAI_ALLOW_INSECURE_HTTP=1`.

Para cambiar de servidor, `modai server logout` borra el servidor y la API key guardados (conserva tus publicadores de confianza) y luego `modai server connect <otra-url>`. `modai server keys` lista tus API keys y `modai server revoke-key <id>` revoca una.

Dentro de un proyecto, `modai server ping` revisa también sus registries y sale con código 1 si el servidor no responde. Los proyectos vinculados informan al servidor qué tienen instalado y el panel muestra qué proyectos usan cada paquete (desactívalo con `MODAI_NO_USAGE_REPORT=1`).

Proyectos del servidor: `modai project list/create`, `project update <id> --name … --organization …` y `project delete <id>` (borra su memoria y ejecuciones; pide confirmación y solo lo puede hacer un administrador o quien lo creó).

## Administrar el servidor desde la CLI

Cada comando respeta los permisos de la credencial conectada.

```bash
modai package deprecate @skills/x@0.1.0 --message "usa 0.2.0"   # sigue resolviendo
modai package yank @skills/x@0.1.0 --reason "defecto crítico"   # fuera de nuevas resoluciones
modai package unpublish @skills/x@0.1.0 --confirm               # solo tras yank; administración global
modai package usage @skills/x                                   # proyectos que lo usan

modai knowledge add --title "Guía de despliegue" --file guia.md --tags deploy
modai knowledge list && modai knowledge update <id> --file guia.md && modai knowledge remove <id>

modai memory add "Las fechas van en UTC" --kind decision --project mi-api
modai memory import decisiones.md --project mi-api        # JSON, JSONL o viñetas Markdown
modai memory export memorias.jsonl --project mi-api

modai admin users
modai admin create-user ana --password '…' --role publisher --organizations ORG --projects mi-api --scopes @skills
modai admin update-user <id> --disable
modai admin create-key --label worker-ci --owner ci-bot --role worker --projects ID
modai admin keys && modai admin revoke-key <id>
modai admin organizations && modai admin namespaces
modai admin create-namespace @acme-pagos --organization ORG      # o --user ana
modai admin update-namespace @skills --organization ORG --restricted
modai admin trust-publisher public.pem --label equipo && modai admin publishers
modai admin audit --limit 50
modai admin export ./modai-backup.json && modai admin import ./modai-backup.json
modai admin prune --memory-days 365 --audit-days 90 --dry-run
modai category list && modai category create backend
```

Cada paquete pertenece a su namespace (`@namespace/nombre`) y cada namespace tiene un solo dueño: una organización o un usuario. Cada usuario recibe con su cuenta el namespace personal `@usuario`; los demás se crean antes de publicar en ellos.

Roles: `reader`, `publisher`, `worker`, `org-admin` y `admin`. Una API key pertenece a un usuario y nunca supera sus permisos; `--service` crea una sin dueño, solo para automatizar la instalación. El backup incluye paquetes, artefactos, conocimiento manual, memorias, publicadores, proyectos, organizaciones y namespaces, y excluye API keys y secretos.

## Agentes y workers

Un agente es una contribución (`contributes.agents`) de un paquete publicado en el servidor. Trabaja sobre un proyecto vinculado (`modai init --project ID`):

```bash
modai agent list
modai agent compose @agents/backend-reviewer        # paquetes, instrucciones y capacidades resueltos
modai agent activate @agents/backend-reviewer --adapter agents-md --allow project.instructions
modai agent run "Revisa las decisiones de arquitectura" --model MODELO_LOCAL
modai agent deactivate
```

La activación compone el agente en el servidor, verifica artefactos y firmas, fija las versiones del bundle en el proyecto, instala sus skills y genera `.modai/agent.md`, `.modai/activation.json` y `.modai/mcp.json`. `--adapter` es `files` (por defecto, sin tocar instrucciones raíz), `agents-md` o `claude-md` (bloque administrado). Si el agente usa servidores MCP, autorízalos con `--allow mcp.connect --allow-mcp NOMBRE` y `--allow-env VARIABLE`; esas aprobaciones se guardan en un archivo privado de este equipo, nunca en el repositorio.

`agent run` usa Ollama en este equipo, con un máximo de 12 pasos (`--max-steps` hasta 32). No tiene acceso implícito al repositorio, a la shell ni a modelos cloud: solo a las herramientas seleccionadas y autorizadas.

**Cola y workers.** Una tarea se encola y la procesa otro equipo con una API key `worker`, acceso al proyecto y un modelo local:

```bash
modai agent submit "Revisa las decisiones de arquitectura" [--idempotency-key K]
modai agent runs list && modai agent runs show ID && modai agent runs cancel ID
modai agent worker --project ID_PROYECTO --model MODELO_LOCAL [--once]
```

El worker exige por defecto publicadores de confianza (`--signature-policy trusted`): registra sus claves con `modai permissions trust public.pem`. Reclama tareas con un lease de 60 segundos que renueva mientras trabaja; si cae, otra instancia la retoma (máximo tres intentos). La entrega es al menos una vez: los servidores MCP con efectos externos deben ser idempotentes.

**Firmas.** `modai permissions signatures optional|signed|trusted` fija el mínimo de este equipo. `signed` comprueba integridad con cualquier clave; solo `trusted` garantiza quién publica. Una firma válida acredita autoría, no que las instrucciones o herramientas sean inocuas.

## Harness engineering

Un harness fiable tiene cinco subsistemas: instrucciones (un router corto con prioridades e invariantes), herramientas y entorno (bootstrap y comandos reproducibles), estado y contexto (progreso durable), alcance (una tarea a la vez, con evidencia) y feedback (gates ejecutables, estado limpio y handoff).

```bash
modai harness init [--agent-file CLAUDE.md]   # crea la base y detecta los scripts de Node del proyecto
modai harness audit                           # puntúa la estructura y propone correcciones
```

La puntuación no sustituye probar con sesiones reales. Paquetes relacionados: `@skills/harness-authoring`, `@skills/skill-authoring`, `@skills/design-patterns` y `@profiles/harness-engineer`.

## Modelos locales y búsqueda semántica

La inferencia y los embeddings ocurren en tu equipo, nunca en el servidor. Instala [Ollama](https://ollama.com/download) en el equipo cliente:

```bash
modai client doctor                          # arquitectura, CPU, memoria, GPU y runtime local
modai client setup --download                # elige y descarga un modelo de embeddings
modai client setup --preference quality --download --with-chat
modai client benchmark --models embeddinggemma:300m,qwen3-embedding:0.6b
modai client embed index [--package @skills/design-patterns]   # requiere publisher o admin
modai client embed search "cuándo elegir Strategy frente a State"
```

- El diagnóstico no sale de tu equipo. La configuración queda en `~/.modai/local-models.yaml` (URL, modelo, digest de pesos y lote).
- El runtime solo acepta direcciones de loopback, sin credenciales ni redirecciones, y rechaza modelos cloud. Sin `--download` solo se usan modelos ya instalados.
- La selección es una heurística: reserva la mitad de la RAM y 1,5 GiB de la memoria libre. CPU o GPU sin memoria verificable usan un modelo pequeño; Apple Silicon y NVIDIA con VRAM verificada pueden subir de modelo y lote; `quality` propone `qwen3-embedding:4b` con al menos 8 GiB de presupuesto.
- El espacio vectorial incluye modelo, digest y versión del preprocesamiento: cambiar de modelo crea otro índice. El servidor valida un hash del texto antes de aceptar cada vector (`DOCUMENT_CHANGED` si el documento cambió). Reindexar es idempotente.
- La búsqueda de texto (`modai context search`, `modai_search_knowledge`) funciona siempre, sin runtime ni modelos.

## Referencia de comandos

Los comandos del día a día del proyecto van sueltos; el resto está agrupado por tema.

| Grupo                        | Comandos                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proyecto                     | `init`, `template init/list/use/info/publish/download`, `feature list/enable/disable/reset/define/undefine`, `add`, `remove`, `update [--keep-mine]`, `outdated`, `sync [--frozen]`, `status`, `list [tipo] [--available]` (`ls`), `override` |
| Muchos repositorios          | `workspace list/add/remove/update/sync` (`ws`)                                                                                                                                                                                                |
| Lo que instalan los paquetes | `component create/list`, `harness init/audit`, `adapter list/add/remove`, `capability list/tools/run/providers/use`, `permissions list/grant/revoke/trust/signatures`                                                                         |
| Contexto y memoria           | `context search/show`, `memory add/search/list/update/remove/import/export`, `knowledge list/show/search/add/update/remove`                                                                                                                   |
| Publicar paquetes            | `package scaffold/validate/keygen/publish/usage/download/deprecate/yank/unpublish`, `skill list/publish/export`, `category list/create/update/delete`, `registry list/add/remove/packages`                                                    |
| Servidor                     | `server connect/ping/whoami/keys/revoke-key/logout`, `project list/create/update/delete`, `agent list/compose/activate/deactivate/run/submit/runs/worker`, `admin …`                                                                          |
| Este equipo                  | `client doctor/setup/benchmark/embed`, `upgrade [--check] [--tag next]`                                                                                                                                                                       |

`modai <comando> --help` muestra las opciones de cada uno. Todas las salidas son tablas legibles; añade `--json` a cualquier comando para usarlo en scripts.

### Modo interactivo

En una terminal, la CLI pregunta lo que falta en vez de fallar: `modai init` sin opciones te guía (nombre, agentes, proyecto del servidor, perfil), `modai add` sin paquete abre un buscador del catálogo y luego sus opciones, `modai template use` sin template deja elegirlo, la carpeta y sus opciones, y `server connect`, `feature define` y `category create` piden los datos que no pasaste. Las confirmaciones y la API key también son preguntas (la clave no se muestra). Ctrl+C cancela sin cambios.

Nada de esto ocurre en scripts: con `--json`, en CI, sin terminal o con `MODAI_NO_PROMPT=1`, un dato que falte produce un error que dice qué flag pasar. Los colores se adaptan a la terminal (Linux, macOS y Windows) y se desactivan con `NO_COLOR=1`.

### Si algo no funciona

| Síntoma                                      | Qué revisar                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CAPABILITY_UNSATISFIED`                     | Falta un proveedor del contrato: `modai capability providers <capacidad>`                |
| `PERMISSION_REQUIRED … project.instructions` | Un adaptador escribe instrucciones del agente: repite con `--allow project.instructions` |
| Una herramienta no aparece en el agente      | Autorízala con `modai permissions grant <paquete>` y reinicia el cliente MCP             |
| `MANAGED_CONFLICT`                           | Editaste un archivo administrado: integra tus cambios, `--keep-mine` o `--force`         |
| `LOCK_INTEGRITY_MISMATCH`                    | El registry sirve contenido distinto para la misma versión: no se instala, por seguridad |

## Actualizar

```bash
modai upgrade            # instala la última versión con el gestor que usaste (npm, pnpm, yarn o bun)
modai upgrade --check    # solo avisa si hay una versión nueva
```

Una vez al día, la CLI avisa si hay una versión nueva. Puedes desactivar el aviso con `MODAI_NO_UPDATE_NOTIFIER=1`, y nunca aparece en CI.

## Requisitos

- Node.js `>=26.13.0 <27`.
- Opcional: [Ollama](https://ollama.com) para ejecutar agentes y calcular embeddings en tu equipo.

[Repositorio](https://github.com/sorodriguezz/MODAI) · [Cambios](https://github.com/sorodriguezz/MODAI/blob/main/CHANGELOG.md) · [Reportar un problema](https://github.com/sorodriguezz/MODAI/issues)
