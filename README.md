# MODAI · Paquetes y capacidades extensibles para agentes de IA

MODAI (ModularAI) es un **gestor de paquetes para capacidades de IA**. Instala en tus proyectos conocimiento, skills, reglas, herramientas ejecutables, adaptadores y perfiles; resuelve sus dependencias **por contrato de capacidades**; los conecta con el agente que uses y los retira sin destruir tus cambios.

> MODAI no crece agregando funcionalidades a su Core. Crece con paquetes que el Core descubre, instala, configura y conecta. — [ADR-004](docs/architecture/ADR-004-package-platform.md)

```text
                    Proyecto del desarrollador
                 modai.yaml · modai.lock · agente
                              │
          MODAI CLI  ─────────┼──────────  modai-mcp (gateway)
                              │
 ┌─────────────────────────── MODAI Core ───────────────────────────┐
 │ Package Manager · Dependency & Capability Resolver ·             │
 │ Context Gateway (conocimiento + memoria) · Adapter System        │
 └──────────────────────────────────────────────────────────────────┘
        │ paquetes instalables (nunca código del Core)
  Frontend · Backend · Testing · Arquitectura · Agentes · Harnesses
  Memorias · Integraciones · Adaptadores (Claude Code, Cursor, …)
        │
  Registries: carpeta local/compartida · servidor MODAI (opcional)
```

El Core conoce contratos, no frameworks: no sabe qué es React, NestJS, SDD o Playwright. `@testing/regression` declara `requires: browser.automation@^1`; `@testing/playwright` la `provides`. Mañana otro paquete puede proporcionarla sin cambiar ni el Core ni el paquete de regresión.

## Empezar en 1 minuto (sin servidor)

```sh
npm install -g @sorodriguez/modai
cd mi-proyecto
modai init --registry ~/modai-registry --adapter agent-skills,claude-code,mcp --allow project.instructions
modai add @profiles/fullstack-quality       # o paquetes sueltos: @testing/regression, @patterns/frontend-architecture…
modai capabilities
modai grant @testing/playwright              # instalar no equivale a autorizar ejecución
modai search "cómo ubicar el estado compartido"
```

Para tener el catálogo de ejemplo en tu registry local: `for d in examples/packages/*/; do modai publish "$d" --registry ~/modai-registry; done`.

Qué obtienes:

- **Reproducibilidad**: `modai.yaml` (lo pedido) + `modai.lock` (versiones, `integrity` SHA-256, proveedores y cada archivo administrado). `modai sync --frozen` reconstruye exactamente lo mismo en otro equipo o en CI.
- **Reversibilidad**: `modai remove` retira solo lo que sigue intacto; tus ediciones se conservan y se informan.
- **Seguridad**: herramientas y servidores MCP de paquetes se habilitan con `modai grant`, por equipo y ligados al contenido exacto. MODAI no es un sandbox y lo declara.
- **Portabilidad**: cambiar de agente es cambiar `adapters` en `modai.yaml`. Integrados: `agent-skills`, `agents-md`, `claude-code`, `mcp`; nuevos agentes llegan como paquetes `kind: Adapter` (ver `@adapters/cursor`, `@adapters/opencode`).
- **Contexto bajo demanda**: el gateway MCP entrega fragmentos de conocimiento con procedencia, memoria del proyecto y skills como recursos, sin cargar todo el catálogo en el prompt.

Crear tu propio paquete — por ejemplo de pruebas de regresión — y publicarlo sin tocar MODAI: [guía de autoría](docs/guides/AUTHORING-PACKAGES.md) · [especificación v1](docs/spec/PACKAGE-SPEC-v1.md) · [migración desde 0.5](docs/guides/MIGRATION-0.6.md).

## Servidor central (opcional)

El servidor MODAI aporta un **registry privado**, memoria compartida por equipo, panel web con usuarios y roles, auditoría, backups, composición de agentes y workers. **El servidor no ejecuta modelos.** Docker aloja el registro, la API y el panel; Ollama u otro runtime, el modelo y el agente se ejecutan en el equipo cliente.

```text
Servidor MODAI (Docker)                   Equipo cliente
┌───────────────────────────┐           ┌─────────────────────────────┐
│ Registry y artefactos     │  CLI      │ Proyecto: modai.yaml / lock │
│ Memoria compartida        │ ◄───────► │ Editor / agente             │
│ Panel, usuarios, auditoría│  MCP/API  │ Ollama u otro runtime       │
│ Agentes y cola de tareas  │ ◄───────► │ Modelo local                │
└───────────────────────────┘           └─────────────────────────────┘
```

## Agentes, MCP y cliente independiente

El servidor registra proyectos y compone agentes versionados con sus skills, herramientas y política de memoria. Este flujo usa proyectos en formato 0.5 (`modai init --legacy`):

```sh
modai init --legacy --project ID_DEL_PROYECTO
modai agent activate @agents/backend-reviewer --adapter agents-md --allow project.instructions
modai agent run "Revisa las decisiones del proyecto" --model MODELO_LOCAL
```

Consulta [agentes y capacidades](docs/guides/AGENTS-AND-CAPABILITIES.md). El único paquete destinado a npm es `@sorodriguez/modai`; incorpora el Core, el SDK y los contratos internos.

## Una instancia central para todos tus proyectos

El administrador despliega el servidor con una dirección accesible, crea el proyecto en el panel y abre **Conectar un cliente → Dar acceso a un usuario**. Cada usuario recibe su propia API key y los comandos del proyecto:

```sh
# Una vez publicado el CLI en npm:
npm install -g @sorodriguez/modai
modai connect https://modai.tu-dominio.cl
# connect pide la API key con entrada oculta.
cd mi-proyecto
modai init --project ID_DEL_PROYECTO   # el servidor queda como registry y la memoria se comparte con el equipo
modai add @skills/design-patterns
```

Si el repositorio ya contiene `modai.yaml`, se usa `modai sync` en lugar de `init`. Los equipos autorizados comparten el contexto del mismo proyecto. El editor consulta capacidades por `modai-mcp`; la ejecución puede ser local o mediante un worker. Antes de publicar en npm puedes distribuir el único `.tgz` que genera `npm run pack:client`.

La [guía del servidor central](docs/guides/CENTRAL-SERVER.md) cubre red local, dominio y HTTPS, usuarios, memoria, MCP y workers. La [guía de publicación](docs/guides/PUBLISH-CLI.md) explica cómo subir únicamente el CLI a npm.

## Levantar el servidor con Docker

Necesitas Docker Engine con **Compose v2**, o Docker Desktop, en ejecución. Para levantar solamente el servidor no necesitas instalar Node, Ollama ni modelos en el host. La imagen compila y ejecuta la aplicación con **Node 26.13.0**.

Todos los comandos siguientes se ejecutan desde la raíz de este repositorio, salvo que se indique otra carpeta.

### 1. Configurar el acceso

En PowerShell:

```powershell
cd C:\ruta\MODAI
if (-not (Test-Path deploy/.env)) { Copy-Item deploy/.env.example deploy/.env }
notepad deploy/.env
```

En Linux/macOS, copia el archivo con `cp -n deploy/.env.example deploy/.env` y ábrelo con tu editor.

Si ya tienes `deploy/.env`, conserva ese archivo. Reemplaza el token de ejemplo por uno largo y aleatorio:

```dotenv
MODAI_BIND_IP=127.0.0.1
MODAI_PORT=8787
MODAI_API_TOKEN=REEMPLAZAR_POR_UN_SECRETO_PROPIO
MODAI_HOSTNAME=modai.local
```

Compose lee `deploy/.env` automáticamente porque está junto al archivo Compose. Este archivo no se incluye en Git ni en la imagen Docker.

### 2. Construir e iniciar

```sh
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

La primera construcción instala dependencias, compila TypeScript y ejecuta las pruebas. El servicio aparecerá como `healthy` cuando termine el arranque.

Abre [el panel de MODAI](http://127.0.0.1:8787/admin). La primera vez crea la cuenta de administrador (se pide `MODAI_API_TOKEN` como secreto de arranque, o defínela con `MODAI_ADMIN_USERNAME`/`MODAI_ADMIN_PASSWORD`); después inicia sesión con usuario y contraseña. Consulta la [guía del panel](docs/guides/ADMIN-PANEL.md). El endpoint [de salud](http://127.0.0.1:8787/health) permite comprobar versión y runtime sin autenticación.

Por defecto el puerto solo es accesible desde este PC. MODAI exige credenciales desde el arranque: no existe administración anónima y revocar la última clave no abre el servidor.

### 3. Cargar los ejemplos

```sh
docker compose -f deploy/compose.yaml --profile examples run --build --rm seed-examples
```

El proceso publica el catálogo mediante la API utilizando el token de `deploy/.env`. Omite las versiones que ya existen. Después pulsa **Actualizar** en el panel.

Incluye skills de patrones de diseño, creación de skills, harness engineering y NestJS; conocimiento de arquitectura hexagonal; perfiles backend y harness-engineer; SDD, OpenCode, memoria, MCP y configuración de Ollama **para el cliente**.

## Conectar un proyecto y usar sus capacidades

El **equipo cliente** necesita Node 26.13.0 y acceso al servidor. El cliente se distribuye como paquete independiente. Para construir y enlazar la versión de desarrollo desde este repositorio:

```sh
npm ci
npm run build
npm link --workspace @sorodriguez/modai
modai connect http://127.0.0.1:8787
# Introduce tu API key cuando se solicite.
```

Si el servidor está en otro equipo, sustituye `127.0.0.1` por su dirección. Usa una API key propia para cada cliente; el panel permite crearlas con permisos de lectura, publicación o administración.

Ahora entra en el proyecto donde quieres usar las capacidades. Carga primero el catálogo del paso anterior si vas a utilizar estos perfiles de ejemplo:

```sh
cd ruta/a/mi-proyecto
modai init --profile @profiles/harness-engineer
modai status
modai search "cuándo usar Strategy o State"
modai harness init .
modai harness audit .
```

El perfil instala las skills de autoría de harnesses, skills y patrones de diseño, junto con los contratos de memoria y MCP. Los archivos quedan en el proyecto, por ejemplo en `.agents/skills/`; tu agente debe poder leer esa ubicación. **Instalar un paquete no inicia un modelo ni convierte por sí solo el proyecto en un agente.**

También puedes empezar sin perfil y añadir paquetes individualmente:

```sh
modai init
modai add @skills/design-patterns
modai add @knowledge/hexagonal
modai remember "Las reglas de negocio no dependen del framework" --kind decision
modai recall "reglas de negocio"
modai outdated
modai update
```

Ejecuta `modai init` una sola vez por proyecto. Para un proyecto ya inicializado usa `modai add`, incluso para añadir un perfil.

`modai.yaml` conserva registries, dependencias directas, adaptadores y memoria; `modai.lock`, las versiones resueltas con su integridad. Versiona ambos. `.modai/store/` y `.modai/context-index.json` son caché reconstruible (ya excluida por `.modai/.gitignore`). La conexión global de la CLI se guarda en `~/.modai/client.yaml`; el token no se copia al repositorio del proyecto.

Para que un agente consulte contexto y memoria durante sus sesiones, configura el servidor MCP `modai-mcp` en tu cliente. Consulta la [guía MCP](docs/guides/MCP.md). MCP y el runtime de modelos se ejecutan del lado del cliente.

## Embeddings y modelos adecuados para tu equipo

Ejecuta estos comandos **en el cliente donde corre el agente**, con Ollama instalado y en ejecución de forma nativa:

```sh
modai client doctor
modai client setup --download
modai embed index
modai embed search "cómo organizar las responsabilidades del dominio"
```

`doctor` detecta SO, arquitectura, CPU, RAM disponible y GPU cuando puede consultarla. No descarga ni ejecuta modelos. `setup --download` selecciona un modelo según esos recursos, lo descarga en tu Ollama local, comprueba que genera embeddings y guarda la configuración solo en ese equipo. `embed index` lee el conocimiento de MODAI, calcula sus vectores en el cliente y los sube al servidor; requiere permiso de publicación. La búsqueda semántica calcula también el vector de la consulta localmente.

La selección contempla CPU sin GPU dedicada, Mac Intel, Apple Silicon con memoria unificada, Windows ARM y GPUs NVIDIA/AMD/Intel. Detectar una GPU no garantiza que sus drivers o el runtime la aceleren: se reserva memoria para otras aplicaciones y se conserva una alternativa pequeña para CPU. No instala drivers ni modifica el sistema.

Para priorizar calidad en un equipo con recursos o elegir manualmente:

```sh
modai client setup --preference quality --download
modai client setup --embedding-model embeddinggemma:300m --download
modai client benchmark --models embeddinggemma:300m,qwen3-embedding:0.6b
```

Los modelos del benchmark deben estar instalados. Mide latencia real, no calidad; no hay un modelo universalmente «mejor» para todos los equipos y proyectos. Cambiar de modelo o de sus pesos requiere volver a indexar; los espacios vectoriales se mantienen separados.

El setup también recomienda un modelo de chat para tu agente. No lo descarga por defecto; si lo quieres, usa `modai client setup --download --with-chat`. **La inferencia de chat sigue a cargo de tu agente y de su runtime local.** Si no quieres modelos, `modai search` continúa funcionando con búsqueda de texto.

Consulta [la guía de modelos y embeddings del cliente](docs/guides/CLIENT-MODELS.md) para compatibilidad, límites, memoria, configuración y fuentes.

## Publicar tus propias skills o paquetes

```sh
modai package scaffold ./mi-paquete --name @acme/mi-paquete --category testing --with-tool
# Edita modai.package.yaml, skills/, knowledge/, rules/ y tools/.
modai package validate ./mi-paquete
modai publish ./mi-paquete --registry ~/modai-registry   # o la URL de tu servidor MODAI
```

Cada paquete tiene un manifiesto `modai.package.yaml` (`apiVersion: modai.dev/v1`) que declara capacidades provistas y requeridas, dependencias, permisos y contribuciones. Referencias: [`@testing/regression`](examples/packages/testing-regression/modai.package.yaml), [`@testing/playwright`](examples/packages/testing-playwright/modai.package.yaml), [`@patterns/frontend-architecture`](examples/packages/patterns-frontend-architecture/modai.package.yaml) y [`@adapters/cursor`](examples/packages/adapter-cursor/modai.package.yaml). Los manifiestos 0.5 (`schemaVersion: 1`) siguen siendo válidos.

Una versión publicada es inmutable: para cambiar su contenido incrementa su versión. Publicar y escribir conocimiento o memoria requiere un token `publisher` o `admin`; un token `reader` permite consultar e instalar paquetes.

## Operación diaria

Desde la raíz del repositorio:

| Acción | Comando |
|---|---|
| Ver estado | `docker compose -f deploy/compose.yaml ps` |
| Seguir logs | `docker compose -f deploy/compose.yaml logs -f server` |
| Reconstruir tras cambios | `docker compose -f deploy/compose.yaml up -d --build` |
| Aplicar cambios de configuración | `docker compose -f deploy/compose.yaml up -d --force-recreate` |
| Detener conservando datos | `docker compose -f deploy/compose.yaml down` |
| Exportar backup con la CLI conectada | `modai admin export ./modai-backup.json` |

Los datos de Docker viven en los volúmenes `modularai_modai-data` y `modularai_modai-artifacts`. **No uses `down -v` si quieres conservarlos.** Los backups exportados excluyen API keys y secretos; conserva también copias de los volúmenes para recuperación completa.

Si tienes Node instalado, los atajos `npm run docker:up`, `docker:down`, `docker:logs`, `docker:ps` y `docker:seed` ejecutan los mismos flujos mediante [scripts/deploy.mjs](scripts/deploy.mjs).

### Acceso desde la red local

Configura en `deploy/.env` un token y un hostname que los clientes puedan resolver. Para HTTPS con la CA interna de Caddy:

```sh
docker compose -f deploy/compose.yaml -f deploy/compose.lan.yaml up -d --build
```

Accede a `https://HOST:8443`, sustituyendo `HOST` por `MODAI_HOSTNAME`. Los clientes necesitan resolver ese nombre y confiar en la CA interna de Caddy. El puerto HTTP de MODAI puede seguir limitado a loopback; Caddy lo alcanza por la red interna de Docker. Para HTTP directo en una LAN de confianza, configura `MODAI_BIND_IP=0.0.0.0` y recrea el servidor.

### Si algo no funciona

| Síntoma | Qué revisar |
|---|---|
| El panel no abre | Docker en ejecución, `ps`, logs y puerto configurado en `deploy/.env`. |
| «Token inválido o ausente» | Usa el token del servidor o una API key activa en **Conexión**; comprueba el token de la CLI. |
| «Se requiere rol…» | Utiliza una API key con permiso suficiente para esa operación. |
| El catálogo está vacío o un perfil no existe | Carga los ejemplos o publica tus propios paquetes. El catálogo comienza vacío. |
| La CLI muestra error de versión de Node | Usa Node 26.13.0; `.nvmrc` y `.node-version` fijan esa versión. |
| Cambiaste el token y no se aplica | Recrea el servidor; `restart` no actualiza las variables del contenedor. |

## Estructura del repositorio

```text
MODAI/
├── deploy/                 # Dockerfile, Compose, Caddy y ejemplo de entorno
├── docs/
│   ├── architecture/       # Decisiones (ADR-004: plataforma de paquetes)
│   ├── spec/               # Especificación de paquetes v1
│   └── guides/             # API, MCP, administración y harness engineering
├── examples/packages/      # Catálogo opcional de paquetes publicables
├── scripts/                # Automatización de despliegue y carga de ejemplos
├── apps/
│   ├── server/             # API, autorización, catálogo, contexto y cola
│   │   └── var/            # Datos locales generados al arrancar sin Docker
│   └── admin/              # Web: HTML, CSS, tema y vistas por sección
├── packages/
│   ├── core/               # Núcleo: resolvedor, capacidades, registries, adaptadores, gateway
│   ├── contracts/          # Contratos internos y especificación v1
│   ├── sdk/                # Cliente HTTP interno, incorporado al CLI
│   └── cli/                # Único paquete npm: modai, MCP y worker
├── tests/                  # Pruebas de integración y comportamiento
├── dist/                   # Salida de compilación, generada
└── node_modules/           # Dependencias instaladas, generadas
```

`package.json`, el lockfile y la configuración de TypeScript y Node permanecen en la raíz porque son puntos de entrada de sus herramientas. `dist/` y `node_modules/` no se editan a mano. En Docker se usan volúmenes; `apps/server/var/` corresponde a la ejecución local. La [guía de estructura](docs/architecture/PROJECT-LAYOUT.md) detalla los límites y el desarrollo de cada aplicación.

## Desarrollo y documentación

Con Node 26.13.0:

```sh
npm ci
npm run build
npm test
npm run dev
```

El servidor de desarrollo crea `apps/server/var/data/` y `apps/server/var/artifacts/` al necesitarlos. Si Docker ya ocupa el puerto 8787, detenlo o asigna otro `MODAI_PORT` al proceso local. Puedes configurar `MODAI_API_TOKEN`, `MODAI_DATABASE_PATH` y `MODAI_ARTIFACT_DIR` como variables de entorno; `npm run dev` no carga `deploy/.env` automáticamente.

Consulta el [índice de documentación](docs/README.md), la [API](docs/guides/API.md), la [administración](docs/guides/MANAGEMENT.md), [modelos del cliente](docs/guides/CLIENT-MODELS.md), [MCP](docs/guides/MCP.md), [harness engineering](docs/guides/HARNESS-ENGINEERING.md) y el [historial de cambios](CHANGELOG.md).

## Alcance actual

El Core funciona sin servidor; los registries de carpeta y el servidor central son intercambiables. El panel web usa cuentas de usuario con sesión; la CLI, MCP y workers usan API keys con roles, proyectos y namespaces. Aún no hay OIDC ni replicación entre servidores, y la composición local de agentes v1 (sin servidor) está planificada en la fase 06 de ADR-004. El panel permite administrar el registro y su contexto; la ejecución de agentes pertenece a las herramientas cliente. La confianza del servidor en publicadores firmados la concede un administrador; los clientes pueden exigir también fingerprints autorizados localmente. Las API keys tienen proyectos, organizaciones y namespaces explícitos. El worker es un proceso opcional separado de la API HTTP.

La búsqueda semántica es opcional: el cliente calcula los embeddings y los envía a la API; MODAI solo los almacena y compara. Las rutas y variables de inferencia con Ollama se retiraron en 0.3.0.
