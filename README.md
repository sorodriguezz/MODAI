# MODAI · Paquetes y capacidades extensibles para agentes de IA

MODAI (ModularAI) es un **gestor de paquetes para capacidades de IA**. Instala en tus proyectos conocimiento, skills, reglas, herramientas ejecutables, adaptadores y perfiles. Resuelve sus dependencias **por contrato de capacidades**, los conecta con el agente que uses (Claude Code, Cursor, OpenCode, cualquier cliente MCP…) y los retira sin destruir tus cambios.

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
  Memorias · Integraciones · Adaptadores
        │
  Registries: carpeta local o compartida · servidor MODAI (opcional)
```

El Core conoce contratos, no frameworks. `@testing/regression` declara `requires: browser.automation@^1` y `@testing/playwright` la `provides`. Mañana otro paquete puede proporcionarla sin cambiar el Core ni el paquete de regresión.

## Qué incluye

| Componente | Qué hace | Dónde |
|---|---|---|
| **CLI** `modai` + gateway `modai-mcp` | Instala, actualiza, retira, autoriza y conecta paquetes; funciona sin servidor | `packages/cli` · npm [`@sorodriguez/modai`](https://www.npmjs.com/package/@sorodriguez/modai) |
| **Core** | Especificación v1, resolvedor de dependencias y capacidades, registries, adaptadores, installer reversible, búsqueda de conocimiento, memoria, ejecución de herramientas | `packages/core` (incluido en la CLI y el servidor) |
| **Servidor central** (opcional) | Registry privado, memoria compartida por equipo, API keys, auditoría, backups, agentes y workers. No ejecuta modelos | `apps/server` · Docker |
| **Panel web** | Inicio de sesión con usuario y contraseña, paquetes y sus contratos, conocimiento, memorias, proyectos, agentes, ejecuciones, usuarios, accesos y auditoría | `apps/admin`, servido en `/admin` |
| **Catálogo de ejemplo** | Frontend, arquitectura, Playwright, regresión, perfil fullstack, adaptadores Cursor/OpenCode, harnesses, skills, conocimiento y un agente de ejemplo | `examples/packages` |

Principios garantizados por el código y los tests:

- **Reproducible**: `modai.yaml` (lo pedido) + `modai.lock` (versiones, `integrity` SHA-256, proveedores y cada archivo administrado). `modai sync --frozen` reconstruye exactamente lo mismo en otro equipo o en CI.
- **Reversible**: `modai remove` solo retira lo que sigue intacto; tus ediciones se conservan y se informan.
- **Seguro**: instalar no autoriza ejecutar. Las herramientas se habilitan con `modai permissions grant`, por equipo y ligadas al contenido exacto. MODAI no es un sandbox, y lo declara.
- **Portable**: cambiar de agente es cambiar `adapters` en `modai.yaml`. Vienen integrados `agent-skills`, `agents-md`, `claude-code` y `mcp`; los agentes nuevos llegan como paquetes `kind: Adapter`.
- **Contexto bajo demanda**: el gateway entrega fragmentos de conocimiento con su procedencia, la memoria y las skills como recursos, sin cargar todo en el prompt.

## Requisitos

- **Node 26.13.0** (`.nvmrc` y `.node-version` lo fijan; con nvm: `nvm use`).
- Para el servidor con Docker: Docker Engine con Compose v2 o Docker Desktop. No necesitas Node en el host.
- Opcional: Ollama en el equipo cliente, para embeddings y para ejecutar agentes con modelos locales.

## Probar localmente

Desde la raíz del repositorio, prepara una vez:

```sh
npm ci
npm run build
npm test            # suite completa: Core, CLI, MCP, servidor, panel y prueba de aceptación
```

### A. Solo la CLI, sin servidor (lo más rápido)

Usa la CLI del repositorio y un registry de carpeta:

```sh
npm link --workspace @sorodriguez/modai     # deja `modai` y `modai-mcp` en tu PATH
# alternativa sin link: npm run cli -- <comando>

# Publica el catálogo de ejemplo en un registry local
for d in examples/packages/*/; do modai package publish "$d" --registry ~/modai-registry; done

# Crea un proyecto de prueba
mkdir -p /tmp/modai-demo && cd /tmp/modai-demo
modai init --registry ~/modai-registry --adapter agent-skills,claude-code,mcp --allow project.instructions
modai add @profiles/fullstack-quality
modai status
modai capability list                          # quién implementa cada contrato
modai list                                  # lo instalado; también: list components, list harness, list skills --available…
modai context search "dónde ubicar el estado compartido"
modai permissions grant @testing/regression --yes       # autoriza sus herramientas en este equipo
modai capability run regression_baseline --input '{"mode":"compare","results":{"tests":[]}}'
modai memory add "Usamos Playwright contra el entorno de staging" --kind decision
modai memory search "staging"
modai remove @testing/regression
```

Para conectar un agente, el adaptador `claude-code` ya escribió `.mcp.json` y el adaptador `mcp` escribió `.modai/mcp.json`. También puedes probar el gateway con el inspector oficial de MCP:

```sh
npx @modelcontextprotocol/inspector modai-mcp --project /tmp/modai-demo
```

### B. Servidor y panel con Node (desarrollo)

```sh
MODAI_API_TOKEN=local-dev-token \
MODAI_ADMIN_USERNAME=admin \
MODAI_ADMIN_PASSWORD='cambia-esta-clave' \
npm run dev
```

- `npm run dev` compila el panel y arranca la API con recarga (`tsx watch`) en `http://127.0.0.1:8787`. Cambia el puerto con `MODAI_PORT`.
- Abre [http://127.0.0.1:8787/admin](http://127.0.0.1:8787/admin) e inicia sesión con `admin` / `cambia-esta-clave`. Si no defines `MODAI_ADMIN_*`, el panel te pide crear el administrador usando `MODAI_API_TOKEN` como token de instalación.
- Los datos quedan en `apps/server/var/` (puedes cambiarlo con `MODAI_DATABASE_PATH` y `MODAI_ARTIFACT_DIR`). Para empezar de cero, borra esa carpeta con el servidor detenido.
- Para trabajar en el panel, ejecuta `npm run dev:admin` en otra terminal y recarga `/admin` después de guardar.

Carga el catálogo en el servidor (en otra terminal):

```sh
MODAI_SERVER=http://127.0.0.1:8787 MODAI_API_TOKEN=local-dev-token npm run seed:examples
```

Conecta la CLI al servidor local y úsalo como registry y memoria compartida:

```sh
modai server connect http://127.0.0.1:8787          # pega local-dev-token o una API key creada en el panel
mkdir -p /tmp/modai-team && cd /tmp/modai-team
modai init                                    # usa el servidor conectado como registry
modai add @testing/playwright @testing/regression
```

Para memoria compartida por un equipo, crea el proyecto en el panel (**Proyectos**) y usa `modai init --project ID`. En **Conectar un cliente** puedes generar una API key por persona con los comandos listos para copiar.

### C. Servidor con Docker (como en producción)

```sh
cp -n deploy/.env.example deploy/.env         # en PowerShell: Copy-Item deploy/.env.example deploy/.env
# Edita deploy/.env: define MODAI_API_TOKEN (largo y aleatorio) y, si quieres,
# MODAI_ADMIN_USERNAME / MODAI_ADMIN_PASSWORD para crear el primer administrador.
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps       # espera a que aparezca "healthy"
docker compose -f deploy/compose.yaml --profile examples run --build --rm seed-examples
```

La primera construcción instala dependencias, compila y ejecuta los tests. Abre [http://127.0.0.1:8787/admin](http://127.0.0.1:8787/admin). [`/health`](http://127.0.0.1:8787/health) muestra la versión sin autenticación. Por defecto el puerto solo escucha en `127.0.0.1`.

### Verificar el paquete npm

```sh
npm run test:client-package   # genera dist/npm/sorodriguez-modai-<versión>.tgz, lo instala aislado y prueba CLI, MCP y worker
```

## Crear tus propios paquetes

Desde el panel web: **Paquetes → Crear paquete** (componente de código, harness, skill o conocimiento), con edición y subida de archivos y validación antes de publicar. Desde la CLI:

```sh
modai component create ./pkg-auth --name @acme/auth-module --from ./src/modules/auth   # tu código como componente reutilizable
modai add @acme/auth-module --allow project.source                                    # en otro proyecto: se copia a src/modules/auth
```

Un paquete se puede armar por partes con **features**: el autor las declara en `spec.features` y quien instala elige con flags, que se guardan en `modai.yaml`.

```sh
modai add @components/health-module --help                      # qué opciones declara
modai add @components/health-module --nestjs --metrics --allow project.source
modai feature disable @components/health-module metrics         # cambiarlas después
modai template use @eq/springboot ./api --sdd --x-lib           # lo mismo para templates
```

```sh
modai package scaffold ./mi-paquete --name @acme/mi-paquete --category testing --with-tool
modai package validate ./mi-paquete
modai package publish ./mi-paquete --registry ~/modai-registry     # o la URL de tu servidor MODAI
modai add file:../mi-paquete                               # instalar sin publicar, mientras desarrollas
```

Un paquete declara sus capacidades (`provides`/`requires`), permisos y contribuciones (`skills`, `rules`, `knowledge`, `tools`, `mcpServers`) en `modai.package.yaml` (`apiVersion: modai.dev/v1`). Las versiones publicadas son inmutables. Referencias: [`@testing/regression`](examples/packages/testing-regression/modai.package.yaml), [`@testing/playwright`](examples/packages/testing-playwright/modai.package.yaml), [`@patterns/frontend-architecture`](examples/packages/patterns-frontend-architecture/modai.package.yaml) y [`@adapters/cursor`](examples/packages/adapter-cursor/modai.package.yaml).

Guía completa: [crear, publicar e instalar paquetes](docs/guides/AUTHORING-PACKAGES.md) · [especificación v1](docs/spec/PACKAGE-SPEC-v1.md).

## Comandos de la CLI

| Comando | Uso |
|---|---|
| `modai init` | Crea `modai.yaml`: registries, adaptadores y memoria (`--registry`, `--adapter`, `--profile`, `--project`) |
| `modai add` / `remove` / `update` / `outdated` / `sync [--frozen]` / `status` | Ciclo de vida reproducible y reversible |
| `modai add <paquete> --<feature>` / `--help` · `modai feature list\|enable\|disable\|reset` | Partes opcionales de un paquete: elegirlas al instalar, ver cuáles ofrece y cambiarlas después |
| `modai capability list` / `providers <capacidad>` / `provider <capacidad> <paquete>` | Contratos instalados, proveedores disponibles y elección de proveedor |
| `modai permissions grant` / `revoke` / `permissions` | Autorización local de herramientas y servidores MCP |
| `modai capability tools` / `tools run` | Herramientas aportadas por paquetes |
| `modai context search` / `context show` / `remember` / `recall` / `memories` / `forget` | Context Gateway y memoria |
| `modai adapter list` / `adapter add` / `adapter remove` | Conectar con otros agentes |
| `modai registry list` / `add` / `remove` / `packages` | Registries del proyecto |
| `modai package scaffold` / `validate` / `keygen`, `modai package publish` | Autoría y publicación (firma Ed25519 opcional) |
| `modai server connect` / `whoami` / `admin …` / `project …` | Servidor central |
| `modai agent …` / `runs …` / `worker` | Agentes compuestos por el servidor (proyectos vinculados con `modai init --project`) |
| `modai workspace add/remove/update/sync/list` | La misma operación en muchos repositorios bajo una raíz, con plan previo y confirmación |
| `modai server ping` | Comprueba si el servidor está arriba: latencia, versión y credencial |
| `modai client doctor` / `setup` / `embed …` | Modelos y embeddings locales con Ollama |
| `modai harness init` / `audit` | Harness de cinco subsistemas para agentes de programación |

`modai <comando> --help` muestra todas las opciones.

## Estructura del repositorio

```text
MODAI/
├── packages/
│   ├── core/          # Núcleo: resolvedor, capacidades, registries, adaptadores, gateway
│   ├── contracts/     # Tipos y esquemas compartidos, incluida la especificación v1
│   ├── sdk/           # Cliente HTTP del servidor
│   └── cli/           # Único paquete npm: modai y modai-mcp
├── apps/
│   ├── server/        # API, autenticación, registry, memoria, agentes y cola
│   └── admin/         # Panel web (HTML, CSS y JS sin dependencias)
├── examples/packages/ # Catálogo de paquetes de referencia
├── tests/             # Pruebas de Core, CLI, MCP, servidor, panel y aceptación
├── deploy/            # Dockerfile, Compose, Caddy y plantilla de entorno
├── scripts/           # Seed del catálogo, empaquetado y smoke del cliente
└── docs/
    ├── architecture/  # ADR-001…004 y organización del proyecto
    ├── spec/          # Especificación de paquetes v1
    └── guides/        # Autoría, panel, servidor central, MCP, API…
```

`dist/` y `node_modules/` son generados. En un proyecto que usa MODAI, versiona `modai.yaml` y `modai.lock`. `.modai/store/` y `.modai/context-index.json` son caché reconstruible, ya excluida por `.modai/.gitignore`.

## Operación del servidor con Docker

| Acción | Comando |
|---|---|
| Ver estado | `docker compose -f deploy/compose.yaml ps` |
| Seguir logs | `docker compose -f deploy/compose.yaml logs -f server` |
| Reconstruir tras cambios | `docker compose -f deploy/compose.yaml up -d --build` |
| Aplicar cambios de `deploy/.env` | `docker compose -f deploy/compose.yaml up -d --force-recreate` |
| Detener conservando datos | `docker compose -f deploy/compose.yaml down` |
| Exportar backup | `modai admin export ./modai-backup.json` (o desde **Auditoría** en el panel) |

Los datos viven en los volúmenes `modularai_modai-data` y `modularai_modai-artifacts`. **No uses `down -v` si quieres conservarlos.** Con Node instalado, `npm run docker:up`, `docker:down`, `docker:logs`, `docker:ps` y `docker:seed` ejecutan los mismos flujos.

Para la red local con HTTPS (CA interna de Caddy): `docker compose -f deploy/compose.yaml -f deploy/compose.lan.yaml up -d --build`. Para un dominio público: `npm run docker:public`. Ver la [guía del servidor central](docs/guides/CENTRAL-SERVER.md).

### Dónde desplegarlo

El servidor necesita un proceso permanente y disco persistente (SQLite y artefactos), por eso no funciona en plataformas serverless como Vercel. Hay configuraciones listas para:

| Entorno | Arranque |
|---|---|
| **Raspberry Pi** (64 bits) | `docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml up -d --build` o `npm run docker:pi` |
| **Fly.io** | `npm run deploy:fly` con `deploy/fly/fly.toml` |
| **Railway** | Repositorio de GitHub + `deploy/railway/railway.json` + volumen en `/app/data` |
| **VPS con dominio** | `npm run docker:public` |

Paso a paso, respaldos (`deploy/backup.sh`) e imagen multi-arquitectura en GHCR: [guía de despliegue](docs/guides/DEPLOY.md).

## Si algo no funciona

| Síntoma | Qué revisar |
|---|---|
| `CAPABILITY_UNSATISFIED` al instalar | Falta un proveedor del contrato; el mensaje sugiere qué paquete añadir (`modai capability providers <capacidad>`) |
| `PERMISSION_REQUIRED … project.instructions` | Un adaptador escribe instrucciones del agente: repite con `--allow project.instructions` |
| Una herramienta no aparece en el agente | Autorízala con `modai permissions grant <paquete>`; revisa `modai capability list` y vuelve a iniciar el cliente MCP |
| `MANAGED_CONFLICT` | Editaste un archivo o bloque administrado: integra tus cambios o usa `--force` |
| `LOCK_INTEGRITY_MISMATCH` | El registry sirve contenido distinto para la misma versión: no se instala, por seguridad |
| El panel no abre o no inicia sesión | ¿El servidor responde en `/health`? Con usuarios ya creados, `MODAI_ADMIN_*` se ignora. Ver la [guía del panel](docs/guides/ADMIN-PANEL.md) |
| El puerto 8787 está ocupado | Detén Docker o usa `MODAI_PORT=8790 npm run dev` |
| Error de versión de Node | Usa Node 26.13.0 (`nvm use`) |
| Cambiaste `deploy/.env` y no se aplica | Recrea el contenedor (`up -d --force-recreate`); `restart` no relee las variables |

## Documentación

- [Índice de documentación](docs/README.md) · [historial de cambios](CHANGELOG.md)
- [ADR-004: plataforma de paquetes y capacidades](docs/architecture/ADR-004-package-platform.md) · [especificación v1](docs/spec/PACKAGE-SPEC-v1.md)
- [Crear y publicar paquetes](docs/guides/AUTHORING-PACKAGES.md)
- [Despliegue: Raspberry Pi, Fly.io y Railway](docs/guides/DEPLOY.md) · [panel web y usuarios](docs/guides/ADMIN-PANEL.md) · [servidor central](docs/guides/CENTRAL-SERVER.md) · [MCP](docs/guides/MCP.md) · [API](docs/guides/API.md)
- [Modelos y embeddings del cliente](docs/guides/CLIENT-MODELS.md) · [agentes y workers](docs/guides/AGENTS-AND-CAPABILITIES.md) · [harness engineering](docs/guides/HARNESS-ENGINEERING.md) · [publicar la CLI](docs/guides/PUBLISH-CLI.md)

## Alcance actual

- El Core funciona sin servidor. Los registries de carpeta y el servidor central son intercambiables.
- El panel web usa cuentas de usuario con sesión. La CLI, MCP y los workers usan API keys con roles, proyectos y namespaces. Aún no hay OIDC ni replicación entre servidores.
- La búsqueda de conocimiento local usa BM25. La búsqueda semántica con embeddings (`modai client embed`) opera con el servidor; los embeddings se calculan siempre en el cliente.
- Los agentes compuestos por el servidor (`modai agent`) funcionan sobre proyectos `modai.yaml` vinculados a un proyecto del servidor (`modai init --project`). Solo se admite el formato de paquete `apiVersion: modai.dev/v1`. Los agentes usan herramientas integradas (`modai_search_knowledge`, `modai_recall`, `modai_remember`) y servidores MCP de `contributes.mcpServers`.
