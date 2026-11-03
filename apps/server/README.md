# Servidor MODAI

**El punto central de MODAI para un equipo.** Es un registry privado de paquetes y un panel web donde se crean y se ven componentes, harnesses, skills y conocimiento. Guarda la memoria compartida de cada proyecto y controla quién accede a qué.

La [CLI](../../packages/cli) funciona sin servidor. Lo levantas cuando quieres que todo el equipo instale desde el mismo catálogo y que los agentes compartan lo que aprenden. El servidor **no ejecuta modelos de IA**: la inferencia y los embeddings ocurren en el equipo de cada persona o en un worker.

## Qué trae

| | |
|---|---|
| **Registry privado** | Paquetes versionados e inmutables con integridad SHA-256, firma Ed25519 opcional, deprecación y retiro de versiones, y resolución de dependencias por contrato. |
| **Panel web** (`/admin`) | Catálogo paginado con filtros por tipo, detalle, archivos, calidad y **qué proyectos usan cada paquete** (y en qué versión). Desde aquí se **crean y publican paquetes** (componentes de código, harnesses, skills, conocimiento) y sus nuevas versiones, con edición de archivos y carpetas. |
| **Conocimiento y memoria** | Documentos que los agentes consultan con búsqueda y memoria por proyecto u organización, compartida por todo el equipo. |
| **Proyectos y accesos** | Proyectos que se crean y se eliminan desde el panel o la CLI, usuarios con contraseña, roles (`reader`, `publisher`, `worker`, `admin`), API keys por persona limitadas a proyectos y namespaces, y organizaciones. |
| **Agentes y ejecuciones** | Composición de agentes desde paquetes y una cola de tareas que procesan workers (`modai agent worker`). |
| **Operación** | Auditoría, métricas Prometheus (`/metrics`), healthcheck (`/health`), export/import de backups y cuotas de almacenamiento. |

## Levantarlo con Docker

Desde la raíz del repositorio:

```bash
cp deploy/.env.example deploy/.env
```

Edita `deploy/.env`: define `MODAI_API_TOKEN` con un valor largo y aleatorio (por ejemplo, la salida de `openssl rand -hex 32`). Si quieres crear el administrador al arrancar, define también `MODAI_ADMIN_USERNAME` y `MODAI_ADMIN_PASSWORD`.

```bash
docker compose -f deploy/compose.yaml up -d --build
```

```bash
docker compose -f deploy/compose.yaml ps        # espera el estado "healthy"
```

Abre <http://127.0.0.1:8787/admin> e inicia sesión. Si no definiste `MODAI_ADMIN_*`, el panel te pide crear el administrador usando `MODAI_API_TOKEN` como código de instalación.

Opcional: carga el catálogo de ejemplo (componentes, harnesses, skills, Playwright, regresión, adaptadores…):

```bash
docker compose -f deploy/compose.yaml --profile examples run --build --rm seed-examples
```

Por defecto el servidor solo escucha en `127.0.0.1`. Para abrirlo a tu red o publicarlo en Internet con HTTPS, mira [Despliegue](#despliegue).

## Conectar al equipo

1. En el panel, crea el proyecto en **Proyectos**.
2. En **Conectar un cliente**, genera una API key para cada persona. El panel muestra los comandos listos para copiar.
3. Cada persona instala la CLI y se conecta:

```bash
npm install -g @sorodriguez/modai
```

```bash
modai server connect https://modai.tu-equipo.cl     # pide la API key sin mostrarla
```

```bash
modai init --project <id-del-proyecto>       # el servidor pasa a ser su registry y su memoria compartida
```

```bash
modai add @acme/auth --allow project.source
```

Antes de empezar, cada persona puede comprobar que llega al servidor y que su key funciona:

```bash
modai server ping
```

Los proyectos vinculados con `--project` informan qué tienen instalado al sincronizar; el panel lo muestra en la pestaña **Proyectos** de cada paquete, solo a quien tiene acceso a esos proyectos.

Para publicar desde la CLI (con una key de rol `publisher` o `admin`):

```bash
modai package publish ./mi-paquete
```

## Configuración

| Variable | Por defecto | Para qué sirve |
|---|---|---|
| `MODAI_API_TOKEN` | — | Código para crear el primer administrador y credencial de recuperación. Obligatoria con Docker Compose y recomendada siempre. |
| `MODAI_ADMIN_USERNAME`, `MODAI_ADMIN_PASSWORD` | — | Crean el primer administrador al arrancar, solo si todavía no hay usuarios. |
| `MODAI_PORT` (o `PORT`) | `8787` | Puerto HTTP. |
| `MODAI_HOST` | `0.0.0.0` | Interfaz de escucha dentro del proceso. Con Compose, la IP publicada se fija con `MODAI_BIND_IP` (por defecto `127.0.0.1`). |
| `MODAI_PUBLIC_URL` | — | URL que el panel muestra a los clientes (por ejemplo, `https://modai.tu-equipo.cl`). |
| `MODAI_TRUST_PROXY` | `false` | Actívalo detrás de un proxy inverso, Cloudflare Tunnel o Tailscale (`true`, número de saltos o IP/CIDR). |
| `MODAI_SIGNATURE_POLICY` | `optional` | `optional`, `signed` (exige firma) o `trusted` (solo publicadores de confianza). |
| `MODAI_ARTIFACT_QUOTA_BYTES` | `1073741824` | Espacio máximo para artefactos de paquetes (1 GiB). |
| `MODAI_DATABASE_PATH`, `MODAI_ARTIFACT_DIR` | `var/data/modularai.db`, `var/artifacts` | Dónde se guardan los datos. En Docker son volúmenes. |

Todos los datos están en una base SQLite y una carpeta de artefactos. Para respaldarlos usa `deploy/backup.sh` (en caliente, con Compose) o `modai admin export backup.json`. Para restaurarlos usa `modai admin import backup.json`.

## Despliegue

| Dónde | Cómo |
|---|---|
| Tu equipo o un VPS | `docker compose -f deploy/compose.yaml up -d --build` |
| Red local con HTTPS | `npm run docker:lan` (Caddy con certificado interno) |
| Internet con dominio | `npm run docker:public` (Caddy con certificado público; requiere DNS y los puertos 80 y 443) |
| Raspberry Pi | `npm run docker:pi` |
| Fly.io | `npm run deploy:fly` |
| Railway | `deploy/railway/` |

Los detalles de cada opción están en la [guía de despliegue](../../docs/guides/DEPLOY.md) y en la [guía del servidor central](../../docs/guides/CENTRAL-SERVER.md).

## Desarrollo

Con Node `>=26.13.0 <27`, desde la raíz del repositorio:

```bash
npm ci && npm run build
```

```bash
MODAI_API_TOKEN=local-dev-token MODAI_ADMIN_USERNAME=admin MODAI_ADMIN_PASSWORD='cambia-esta-clave' npm run dev
```

La API arranca con recarga automática en <http://127.0.0.1:8787> y el panel queda en `/admin`. Para editar el panel en paralelo, ejecuta `npm run dev:admin` y recarga la página.

Pruebas: `npm test` (API, Core, CLI y servidor) y `npm run test:ui` (el panel en Chromium con Playwright, contra un servidor temporal; la primera vez ejecuta `npx playwright install chromium`).

```
src/
  server.ts          proceso y variables de entorno
  http/app.ts        rutas de la API (/api/v1/…)
  http/auth-routes.ts  inicio de sesión del panel
  core/              servicios: paquetes, autenticación, contexto, agentes, ejecuciones, backups, auditoría
```

El panel es una aplicación aparte ([`apps/admin`](../admin)) que el servidor sirve ya compilada. La referencia de la API está en [docs/guides/API.md](../../docs/guides/API.md) y la del panel en [docs/guides/ADMIN-PANEL.md](../../docs/guides/ADMIN-PANEL.md).
