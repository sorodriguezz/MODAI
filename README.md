# MODAI · Paquetes y capacidades extensibles para agentes de IA

MODAI (ModularAI) es un **gestor de paquetes para capacidades de IA**. Instala en tus proyectos conocimiento, skills, reglas, herramientas ejecutables, código reutilizable, adaptadores y perfiles. Resuelve sus dependencias **por contrato de capacidades**, los conecta con el agente que uses (Claude Code, Cursor, OpenCode o cualquier cliente MCP) y los retira sin destruir tus cambios.

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
        │
  Registries: carpeta local o compartida · servidor MODAI (opcional)
```

El Core conoce contratos, no frameworks: `@testing/regression` declara `requires: browser.automation@^1` y `@testing/playwright` la `provides`. Otro paquete puede proporcionarla mañana sin cambiar el Core ni el paquete de regresión.

- **Reproducible**: `modai.yaml` + `modai.lock` (versiones, `integrity` SHA-256, proveedores y cada archivo administrado); `modai sync --frozen` reconstruye lo mismo en CI.
- **Reversible**: `modai remove` solo retira lo que sigue intacto.
- **Seguro**: instalar no autoriza ejecutar; las herramientas se habilitan con `modai permissions grant`, por equipo y ligadas al contenido exacto. MODAI no es un sandbox.
- **Portable**: cambiar de agente es cambiar `adapters` en `modai.yaml`.

## Inicio rápido

Requisitos: Node 26.13.0 (`nvm use`); Docker con Compose v2 para el servidor; opcionalmente Ollama en el equipo cliente.

```sh
npm ci
npm run build
npm link --workspace @sorodriguez/modai      # deja modai y modai-mcp en el PATH (o npm run cli -- <comando>)

for d in examples/packages/*/; do modai package publish "$d" --registry ~/modai-registry; done
mkdir -p /tmp/modai-demo && cd /tmp/modai-demo
modai init --registry ~/modai-registry --adapter agent-skills,claude-code,mcp --allow project.instructions
modai add @profiles/fullstack-quality
modai capability list
modai context search "dónde ubicar el estado compartido"
modai permissions grant @testing/regression --yes
npx @modelcontextprotocol/inspector modai-mcp --project /tmp/modai-demo
```

Servidor y panel en desarrollo (<http://127.0.0.1:8787/admin>):

```sh
MODAI_API_TOKEN=local-dev-token MODAI_ADMIN_USERNAME=admin MODAI_ADMIN_PASSWORD='cambia-esta-clave' npm run dev
MODAI_SERVER=http://127.0.0.1:8787 MODAI_API_TOKEN=local-dev-token npm run seed:examples
```

Con Docker: `cp deploy/.env.example deploy/.env`, define `MODAI_API_TOKEN` y ejecuta `npm run docker:up` y `npm run docker:seed`.

## Repositorio

| Ruta                                                 | Contenido                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`apps/server`](apps/server/README.md)               | API Fastify: registry, autenticación, memoria, agentes, cola y base de datos configurable                          |
| [`apps/admin`](apps/admin/README.md)                 | Panel web en `/admin`, JavaScript sin dependencias de runtime                                                      |
| [`packages/cli`](packages/cli/README.md)             | Único paquete npm, [`@sorodriguez/modai`](https://www.npmjs.com/package/@sorodriguez/modai): `modai` y `modai-mcp` |
| [`packages/core`](packages/core/README.md)           | Núcleo: resolución, instalación reversible, store, adaptadores, workspaces y templates                             |
| [`packages/contracts`](packages/contracts/README.md) | Tipos y esquemas compartidos; especificación de paquetes v1                                                        |
| [`packages/sdk`](packages/sdk/README.md)             | Cliente HTTP tipado de la API                                                                                      |
| `integration/`                                       | Pruebas que cruzan paquetes: CLI contra servidor, MCP, agentes y workers                                           |
| `e2e/`                                               | Pruebas del panel en Chromium con Playwright                                                                       |
| [`deploy/`](deploy/README.md)                        | Dockerfile, Compose, Caddy, Fly.io, Railway y respaldos                                                            |
| `scripts/`                                           | Herramientas del repositorio (ver [Scripts](#scripts))                                                             |
| `examples/packages/`                                 | Catálogo de paquetes de referencia                                                                                 |

Cada paquete y app tiene sus pruebas en `test/`. `dist/` y `node_modules/` son generados; la configuración de una instancia vive en `deploy/.env`, fuera de Git.

## Desarrollo

| Comando                                             | Uso                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`                                     | Compila contracts, sdk, core, CLI, panel, servidor y scripts                        |
| `npm run dev` / `npm run dev:admin`                 | API con recarga / panel reconstruido al guardar                                     |
| `npm test`                                          | Pruebas de paquetes, apps e integración (`MODAI_TEST_DATABASE_URL` para otro motor) |
| `npm run test:ui`                                   | Panel con Playwright (la primera vez: `npx playwright install chromium`)            |
| `npm run format` / `npm run lint`                   | Biome: formatear / comprobar formato y lint                                         |
| `npm run check:architecture`                        | Sin comentarios en `src` (salvo directivas) y archivos de 250 líneas como máximo    |
| `npm run cli -- <comando>`                          | CLI desde el código fuente                                                          |
| `npm run docker:up`, `down`, `ps`, `logs`, `seed`   | Servidor con Docker Compose                                                         |
| `npm run docker:lan`, `docker:public`, `docker:pi`  | Overlays de HTTPS local, dominio público y Raspberry Pi                             |
| `npm run deploy:fly`                                | Despliegue en Fly.io                                                                |
| `npm run pack:client`, `test:client-package`        | Empaqueta la CLI en `dist/npm/` / la instala aislada y prueba CLI, MCP y worker     |
| `npm run version:set -- X.Y.Z`, `check:cli-version` | Una sola versión para todos los workspaces / comprobar que coinciden                |

**Publicar la CLI.** `.github/workflows/npm-publish.yml` publica `@sorodriguez/modai` cuando llega a `main` un cambio de versión en `packages/cli/package.json`: comprueba versiones, compila, prueba, publica con provenance (`latest` o `next` para prereleases) y crea el tag `vX.Y.Z`. Para lanzar: `npm run version:set -- X.Y.Z`, actualiza `CHANGELOG.md` y haz commit. La CLI incorpora core, sdk y contracts en su build; el resto de workspaces son privados.

## Decisiones de arquitectura

- **Plataforma de paquetes.** MODAI no crece agregando funcionalidades a su Core: crece con paquetes que el Core descubre, instala, configura y conecta. La categoría es informativa; el comportamiento depende de las contribuciones y de los contratos de capacidades. Los adaptadores son datos, el resolvedor vive en el Core (instalar no requiere servidor) y el lock guarda hashes de contenido, reproducibles entre registries.
- **Inferencia en el cliente.** El servidor sirve paquetes, conocimiento y memoria, pero no aloja modelos ni genera embeddings: los calcula el cliente con su runtime local y el servidor solo los almacena y compara.
- **Composición de agentes.** Un agente es una contribución de paquete cuyas capacidades nombran herramientas integradas o servidores MCP. El servidor compone un bundle inmutable con versiones exactas y digest; la ejecución ocurre en la CLI o en un worker separado, con una cola de leases y entrega al menos una vez. Nada concede acceso implícito a repositorios, shell, modelos cloud o secretos.

## Scripts

| Script                           | Uso                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `scripts/deploy.mjs`             | Wrapper de Docker Compose con los archivos de `deploy/` (`--lan`, `--public`, `--pi`); no crea credenciales |
| `scripts/seed-examples.ts`       | Publica `examples/packages/` mediante la API (`MODAI_SERVER`, `MODAI_API_TOKEN`); no sobrescribe versiones  |
| `scripts/pack-client.mjs`        | Genera el único `.tgz` npm de la CLI                                                                        |
| `scripts/smoke-client.mjs`       | Instala ese paquete fuera del monorepo y verifica clientes, MCP y worker                                    |
| `scripts/cli-version.mjs`        | `set X.Y.Z` / `check`: versión única del producto en manifiestos y fuentes                                  |
| `scripts/check-architecture.mjs` | Reglas de arquitectura del código fuente                                                                    |

[Historial de cambios](CHANGELOG.md)
