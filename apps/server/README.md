# Servidor MODAI

**El punto central de MODAI para un equipo.** Es un registry privado de paquetes y un panel web donde se crean y se ven componentes, harnesses, skills y conocimiento. Guarda la memoria compartida de cada proyecto, compone agentes, mantiene una cola de tareas para workers y controla quién accede a qué.

La [CLI](../../packages/cli/README.md) funciona sin servidor. Lo levantas cuando quieres que todo el equipo instale desde el mismo catálogo y que los agentes compartan lo que aprenden. El servidor **no ejecuta modelos de IA**: la inferencia y los embeddings ocurren en el equipo de cada persona o en un worker.

- [Qué trae](#qué-trae)
- [Levantarlo](#levantarlo)
- [Conectar al equipo](#conectar-al-equipo)
- [Configuración](#configuración)
- [Base de datos](#base-de-datos)
- [Identidades, roles y accesos](#identidades-roles-y-accesos)
- [Seguridad](#seguridad)
- [API](#api)
- [Operación](#operación)
- [Desarrollo](#desarrollo)

## Qué trae

|                            |                                                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Registry privado**       | Paquetes versionados e inmutables con integridad SHA-256, firma Ed25519 opcional, deprecación y retiro de versiones, y resolución de dependencias por contrato con el mismo resolvedor que la CLI. |
| **Panel web** (`/admin`)   | Catálogo, detalle, archivos, calidad y qué proyectos usan cada paquete. Crear y publicar paquetes y templates, usuarios, accesos y auditoría. Ver [apps/admin](../admin/README.md).                |
| **Conocimiento y memoria** | Documentos que los agentes consultan (texto completo y, opcionalmente, vectores calculados en el cliente) y memoria por proyecto, organización o sesión.                                           |
| **Proyectos y accesos**    | Usuarios con contraseña, API keys por persona, roles, organizaciones, proyectos y namespaces.                                                                                                      |
| **Agentes y ejecuciones**  | Composición de agentes desde paquetes y una cola de tareas con leases que procesan workers (`modai agent worker`).                                                                                 |
| **Operación**              | Auditoría, métricas Prometheus, healthcheck, export/import de backups, retención y cuota de artefactos.                                                                                            |

## Levantarlo

Con Docker, desde la raíz del repositorio:

```bash
cp deploy/.env.example deploy/.env      # define MODAI_API_TOKEN (openssl rand -hex 32) y, si quieres, MODAI_ADMIN_*
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml --profile examples run --build --rm seed-examples
```

Abre <http://127.0.0.1:8787/admin>. Si no definiste `MODAI_ADMIN_*`, el panel te pide crear el administrador usando `MODAI_API_TOKEN` como token de instalación. Por defecto el servidor solo escucha en `127.0.0.1`; HTTPS en la red local, dominio público, Raspberry Pi, Fly.io y Railway están en [deploy](../../deploy/README.md).

Sin Docker, con Node, ver [Desarrollo](#desarrollo).

## Conectar al equipo

```text
Equipo de Ana ── CLI / MCP ──┐
Equipo de Luis ─ CLI / MCP ──┼── https://modai.tu-equipo.cl
Worker opcional ─────────────┘       ├── /admin   panel
                                     ├── /api/v1  catálogo, contexto, proyectos y cola
                                     └── memoria por proyecto / organización / sesión
```

1. En el panel, crea el proyecto en **Proyectos**.
2. En **Conectar un cliente**, cada persona elige qué quiere hacer y genera su API key con los comandos listos para copiar.
3. Cada persona instala la CLI y se conecta:

```bash
npm install -g @sorodriguez/modai
modai server connect https://modai.tu-equipo.cl
modai init --project <id-del-proyecto>
modai add @acme/auth --allow project.source
```

Los clientes usan la dirección pública (`MODAI_PUBLIC_URL`), no `localhost` ni el nombre interno `server` de Compose. Si el repositorio ya contiene `modai.yaml` y `modai.lock`, se usa `modai sync`. Los proyectos vinculados informan qué tienen instalado; el panel lo muestra en la pestaña **Proyectos** de cada paquete, solo a quien tiene acceso a esos proyectos.

## Configuración

| Variable                                       | Por defecto                              | Para qué sirve                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODAI_API_TOKEN`                              | —                                        | Token de instalación y credencial `admin` de recuperación. Obligatorio con Docker Compose; el servidor necesita este token o un administrador sembrado. |
| `MODAI_ADMIN_USERNAME`, `MODAI_ADMIN_PASSWORD` | —                                        | Crean el primer administrador al arrancar, solo si todavía no hay usuarios. Una contraseña que no cumple la política impide arrancar.                   |
| `MODAI_PORT` (o `PORT`)                        | `8787`                                   | Puerto HTTP.                                                                                                                                            |
| `MODAI_HOST`                                   | `0.0.0.0`                                | Interfaz de escucha del proceso. Con Compose, la IP publicada se fija con `MODAI_BIND_IP` (por defecto `127.0.0.1`).                                    |
| `MODAI_PUBLIC_URL`                             | —                                        | Origen HTTP(S) sin ruta que el panel muestra a los clientes y que aparece en `/health`. Con `https://` la cookie de sesión se marca `Secure`.           |
| `MODAI_TRUST_PROXY`                            | `false`                                  | Detrás de un proxy, túnel o Tailscale: `true`, número de saltos o IP/CIDR. Los límites de login usan la IP real del cliente.                            |
| `MODAI_SIGNATURE_POLICY`                       | `optional`                               | `optional`, `signed` o `trusted`. Ver [Seguridad](#seguridad).                                                                                          |
| `MODAI_ARTIFACT_QUOTA_BYTES`                   | `1073741824`                             | Espacio máximo para artefactos de paquetes (1 GiB).                                                                                                     |
| `MODAI_LOGIN_RATE_LIMIT`                       | `10`                                     | Intentos de inicio de sesión por minuto e IP.                                                                                                           |
| `MODAI_DATABASE_URL`                           | —                                        | Motor y conexión. Sin definir, SQLite en `MODAI_DATABASE_PATH`. Ver [Base de datos](#base-de-datos).                                                    |
| `MODAI_DATABASE_PATH`, `MODAI_ARTIFACT_DIR`    | `var/data/modularai.db`, `var/artifacts` | Ubicación de SQLite y de los artefactos (relativas a `apps/server`). Se crean al arrancar; `var/` está ignorada por Git. En Docker son volúmenes.       |
| `MODAI_RUN_UID`, `MODAI_RUN_GID`               | `1000`                                   | Usuario al que baja el contenedor tras ajustar la propiedad de los volúmenes (`MODAI_RUN_AS_ROOT=true` lo evita).                                       |

## Base de datos

El servidor usa [Kysely](https://kysely.dev) y funciona con SQLite (por defecto), PostgreSQL, MySQL y SQL Server:

| Motor      | `MODAI_DATABASE_URL`                                                                                       | Driver                          |
| ---------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------- |
| SQLite     | `sqlite:///ruta/absoluta/modai.db` o `sqlite:ruta/relativa.db` (o sin definir)                             | `better-sqlite3` (incluido)     |
| PostgreSQL | `postgres://usuario:clave@host:5432/modai` (también `postgresql://`)                                       | `pg` (opcional)                 |
| MySQL 8    | `mysql://usuario:clave@host:3306/modai`                                                                    | `mysql2` (opcional)             |
| SQL Server | `sqlserver://usuario:clave@host:1433/modai?encrypt=true&trustServerCertificate=false` (también `mssql://`) | `tedious` y `tarn` (opcionales) |

La base debe existir; el esquema se crea y se actualiza al arrancar (migraciones de Kysely). Los drivers opcionales (`optionalDependencies`) se cargan solo cuando se usa su motor; si falta uno, el servidor lo indica al arrancar (`npm install pg -w @modai/server`).

La búsqueda de conocimiento y memoria usa FTS5 en SQLite y `tsvector` con índice GIN en PostgreSQL. En MySQL y SQL Server usa `LIKE` sin índice: resultados correctos, orden más simple. Los embeddings se guardan normalizados y el ranking vectorial se calcula en workers acotados con límite de candidatos; no es un índice ANN para millones de documentos.

Mantén una sola instancia de la API por base SQLite. Para probar contra otro motor, `MODAI_TEST_DATABASE_URL` con un usuario que pueda crear bases (cada prueba crea la suya):

```bash
MODAI_TEST_DATABASE_URL=postgres://postgres:clave@127.0.0.1:5432/postgres npm test
```

## Identidades, roles y accesos

| Quién                              | Cómo se autentica                       |
| ---------------------------------- | --------------------------------------- |
| Personas en el navegador           | Usuario y contraseña → cookie de sesión |
| CLI, MCP, workers, scripts         | `Authorization: Bearer <API key>`       |
| Instalación inicial y recuperación | `MODAI_API_TOKEN`                       |

| Rol         | Puede                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `reader`    | Catálogo, conocimiento, agentes y la memoria y ejecuciones de sus proyectos.                                                |
| `publisher` | Además, publicar en sus namespaces, crear conocimiento y proyectos, guardar memoria y enviar o cancelar tareas.             |
| `worker`    | Reclamar y completar ejecuciones y escribir memoria en sus proyectos. No publica paquetes.                                  |
| `org-admin` | Usuarios, API keys, proyectos y namespaces solo de sus organizaciones. Sin auditoría, backups, publicadores ni rol `admin`. |
| `admin`     | Todo, incluidos organizaciones, publicadores, auditoría, backups, retención y eliminación definitiva de versiones.          |

- **Cada paquete pertenece a su namespace** (`@namespace/nombre`) y cada namespace tiene un solo dueño: una **organización** o un **usuario**. Cada usuario recibe con su cuenta su namespace personal `@usuario`, donde publica (con rol `publisher` o más) y administra sus paquetes; los demás namespaces se crean antes de publicar en ellos: publicar en uno que no existe responde `404 NAMESPACE_NOT_FOUND`. Un usuario dueño de namespaces con paquetes no se puede eliminar (`USER_OWNS_PACKAGES`) hasta pasarlos a otro dueño. Los proyectos instalan paquetes, no son sus dueños.
- Un namespace `internal` es visible para los miembros de su organización o para su dueño personal. `restricted` exige una asignación explícita, ser el dueño personal o administrar la organización propietaria. `shared` permite lectura a cualquier identidad autenticada. Publicar exige el rol y acceso de publicación al namespace.
- Toda API key pertenece a un usuario y nunca supera sus permisos: mismo rol o menor, y sus mismos accesos o una parte. Se evalúa en cada petición; desactivar a la persona apaga sus keys. Las keys sin dueño (`modai admin create-key --service`) solo sirven para automatizar la instalación.
- Un token se muestra una sola vez; solo se guarda su SHA-256.
- La memoria admite `scope: project|organization|session|user`. Los ámbitos `session` y `user` verifican el propietario y el proyecto. Las propuestas de organización aparecen en la recuperación después de aprobarse y hasta su fecha de revisión, si la tienen. El conocimiento ligado a paquetes hereda la visibilidad del namespace. El conocimiento global está disponible para las identidades autenticadas.

### Perfiles y ejecución por proyecto

Las migraciones se aplican al iniciar. Los namespaces existentes con visibilidad `internal` pasan a usar el ámbito de su propietario. Para conservar un catálogo de instancia, cambia sus namespaces a `shared` explícitamente.

- `GET /api/v1/projects/:id/effective-profile` resuelve las asignaciones del proyecto, su organización y los equipos de la identidad. Devuelve versiones, IDs de artefacto y el digest del perfil.
- Las rutas `/api/v1/{organizations|teams|projects}/:id/bindings` administran asignaciones. El proyecto puede especializar una asignación opcional de su organización o equipo con el mismo `slot`, un motivo y una fecha de revisión. Las asignaciones obligatorias incompatibles producen un error.
- `POST /api/v1/projects/:id/knowledge/search` busca en las versiones del perfil vigente. La búsqueda y los candidatos vectoriales del catálogo aplican los permisos en la base de datos.
- `/api/v1/projects/:id/execution-policy` admite listas de modelos locales y capacidades. Las tareas conservan una copia de la política y del perfil. Los workers necesitan un proyecto explícito en su credencial y acceso a los paquetes de la tarea.
- Los workers extraen temporalmente los artefactos MCP verificados que requiere la ejecución. Las aprobaciones locales de procesos y variables de entorno siguen aplicándose.
- Las transferencias de proyectos entre organizaciones requieren que el proyecto esté vacío de memoria, ejecuciones, instalaciones y políticas. Al transferir un proyecto o namespace se retiran sus asignaciones de acceso anteriores.

## Seguridad

- **Firmas.** `MODAI_SIGNATURE_POLICY=signed` exige firma y comprueba integridad, pero acepta cualquier clave, incluida una recién generada: **solo `trusted` garantiza quién publica** (publicadores registrados con `modai admin trust-publisher public.pem`). Una firma válida acredita autoría, no inocuidad.
- **Contraseñas** con `scrypt` (N=2^15, r=8, p=1), sal por usuario y comparación en tiempo constante; mínimo 10 caracteres. Tras 5 intentos fallidos en 15 minutos el usuario queda bloqueado 15 minutos (por usuario y dirección).
- **Sesiones**: token aleatorio de 256 bits del que solo se guarda el hash; caducan tras 12 horas sin actividad y, como máximo, a los 7 días. Cookie `modai_session` `HttpOnly; SameSite=Strict`, `Secure` con HTTPS.
- **CSRF**: toda escritura con cookie exige `x-modai-csrf: 1`; si llega `Origin`, debe coincidir con el host o con `MODAI_PUBLIC_URL`. CORS está deshabilitado. Con cabecera Bearer se ignora la cookie.
- **Límites**: entradas de 1 MiB, artefactos de 25 MiB decodificados, backups de 1 GiB. `/health` solo revela la versión de Node con credencial.
- El servidor no ejecuta código de paquetes ni modelos. Siempre debe quedar al menos un administrador activo.

Para recuperar el acceso del único administrador:

```bash
curl -s -H "Authorization: Bearer $MODAI_API_TOKEN" https://TU_SERVIDOR/api/v1/admin/users
curl -s -X PATCH -H "Authorization: Bearer $MODAI_API_TOKEN" -H "content-type: application/json" \
  -d '{"password":"nueva contraseña larga"}' https://TU_SERVIDOR/api/v1/admin/users/ID_DEL_USUARIO
```

## API

Base: `/api/v1`. Todo requiere `Authorization: Bearer <token>` o la sesión del panel, salvo `/health`, `GET /api/v1/auth/status`, el login y los assets de `/admin`. Los errores responden `{ error: { code, message } }`. El cliente tipado es [`@modai/sdk`](../../packages/sdk/README.md).

```sh
curl -X POST http://localhost:8787/api/v1/resolve \
  -H "content-type: application/json" -H "Authorization: Bearer $MODAI_API_TOKEN" \
  -d '{"packages":[{"name":"@profiles/fullstack-quality","range":"^1.0.0"}]}'
```

### Sistema

| Método | Ruta       | Uso                                                                |
| ------ | ---------- | ------------------------------------------------------------------ |
| GET    | `/health`  | Estado, versión, `apiVersion: 1`, política de firmas y `publicUrl` |
| GET    | `/metrics` | Métricas Prometheus (reader)                                       |
| GET    | `/api/v1`  | Descripción de la API                                              |

### Sesión y usuarios

| Método          | Ruta                           | Uso                                                                                                        |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| GET             | `/api/v1/auth/status`          | `setupRequired`, identidad, `permissions` y política de contraseña                                         |
| POST            | `/api/v1/auth/setup`           | Primer administrador `{ bootstrapToken, username, displayName?, password }`                                |
| POST            | `/api/v1/auth/login`, `logout` | Iniciar o cerrar sesión                                                                                    |
| GET             | `/api/v1/auth/me`              | Identidad actual                                                                                           |
| POST            | `/api/v1/auth/password`        | `{ currentPassword, newPassword }`                                                                         |
| GET             | `/api/v1/session`              | Identidad, rol, grants y `permissions` de la conexión                                                      |
| GET/POST        | `/api/v1/admin/users`          | Listar / crear `{ username, displayName?, password, role, projectIds?, organizationIds?, packageScopes? }` |
| PATCH/DELETE    | `/api/v1/admin/users/:id`      | Editar rol, accesos, `disabled` o `password` / eliminar                                                    |
| GET/POST/DELETE | `/api/v1/me/api-keys[/:id]`    | Tus API keys; crear solo con sesión del panel                                                              |
| GET/POST        | `/api/v1/admin/api-keys`       | Keys de quienes administras (`?ownerId=`); crear a nombre de alguien (`ownerId: null` = servicio)          |
| PATCH/DELETE    | `/api/v1/admin/api-keys/:id`   | Ajustar dueño y accesos / revocar                                                                          |

### Organizaciones, namespaces y proyectos

| Método       | Ruta                                 | Uso                                                                                              |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| GET/POST     | `/api/v1/organizations`              | Listar con conteos / crear `{ name, description? }` (admin)                                      |
| PATCH/DELETE | `/api/v1/organizations/:id`          | Editar / eliminar una vacía con `{ confirmation: "<nombre>" }`                                   |
| GET/POST     | `/api/v1/namespaces`                 | Listar los visibles / crear `{ name, organizationId \| ownerUserId, description?, visibility? }` |
| PATCH/DELETE | `/api/v1/namespaces/:name`           | Cambiar dueño, descripción o visibilidad / eliminar uno sin paquetes                             |
| GET/POST     | `/api/v1/projects`                   | Proyectos autorizados (con `canDelete`) / registrar uno propio                                   |
| PATCH        | `/api/v1/projects/:id`               | Renombrar `{ name }` o mover `{ organizationId }`                                                |
| DELETE       | `/api/v1/projects/:id`               | Eliminar con `{ confirmation: "<id>" }`; `409 PROJECT_BUSY` si un worker procesa una tarea       |
| PUT          | `/api/v1/projects/:id/installations` | La CLI informa los paquetes instalados del proyecto                                              |

### Paquetes

| Método       | Ruta                                       | Uso                                                                                                           |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| GET          | `/api/v1/packages?q=&type=&name=`          | Listado; `name` filtra por nombre exacto (lo usa `HttpRegistry`)                                              |
| GET          | `/api/v1/packages/catalog`, `/summary`     | Catálogo paginado con filtros (`type=templates`…) y resumen por tipo                                          |
| GET          | `/api/v1/package?name=&version=`           | Metadatos de una versión                                                                                      |
| POST         | `/api/v1/packages`                         | Publicar manifiesto v1 y artefacto inmutable                                                                  |
| POST         | `/api/v1/packages/validate`                | Validar y calcular calidad sin publicar                                                                       |
| POST         | `/api/v1/resolve`                          | Resolver dependencias y capacidades (`409 CAPABILITY_UNSATISFIED`, `422 INCOMPATIBLE_PLATFORM`…)              |
| GET          | `/api/v1/artifacts/:id`                    | Archivos con hashes                                                                                           |
| GET          | `/api/v1/packages/download?name=&version=` | Una versión como ZIP                                                                                          |
| GET          | `/api/v1/packages/usage?name=`             | Proyectos visibles que usan el paquete                                                                        |
| POST         | `/api/v1/packages/import-skill`            | `.skill` → paquete `{ archive, namespace, version?, name?, dryRun? }`                                         |
| POST         | `/api/v1/packages/import-template`         | Publicar un template `{ name, version, description, category?, keywords?, declaration?, archive? \| files? }` |
| GET          | `/api/v1/packages/template?name=&version=` | Opciones (`features`, `addon`) y archivos de un template                                                      |
| POST         | `/api/v1/admin/packages/deprecate`, `yank` | Deprecar o retirar una versión (admin, `org-admin` o usuario dueño del namespace)                             |
| DELETE       | `/api/v1/admin/packages`                   | Eliminar definitivamente una versión retirada (admin)                                                         |
| GET/POST     | `/api/v1/admin/publishers`                 | Publicadores / registrar `{ publicKey, label, trusted }`                                                      |
| PATCH        | `/api/v1/admin/publishers/:fingerprint`    | Confiar o dejar de confiar                                                                                    |
| GET/POST     | `/api/v1/categories`                       | Categorías registradas y en uso / crear `{ name, description? }` (admin)                                      |
| PATCH/DELETE | `/api/v1/categories/:name`                 | Editar descripción / eliminar (admin)                                                                         |

Publicar valida con el validador del Core (`PERMISSION_UNDECLARED`, `MISSING_SOURCE`, `SKILL_ENTRYPOINT_MISSING`, `UNSAFE_TARGET`, `AGENT_CAPABILITY`, `MEMORY_POLICY`…).

### Conocimiento y memoria

| Método       | Ruta                                     | Uso                                                                                                          |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET/POST     | `/api/v1/knowledge/documents`            | Listar paginado (`limit`, `offset`, devuelve `nextOffset`) / crear `{ title, content, tags?, packageName? }` |
| PATCH/DELETE | `/api/v1/knowledge/documents/:id`        | Gestionar un documento manual                                                                                |
| POST         | `/api/v1/knowledge/search`               | Búsqueda de texto `{ query, packageNames? }`                                                                 |
| PUT          | `/api/v1/knowledge/documents/:id/vector` | Guardar `{ model, embedding, sourceHash? }` calculado en el cliente                                          |
| POST         | `/api/v1/knowledge/vector-search`        | `{ model, embedding, limit?, packageNames? }`; `413 VECTOR_CANDIDATE_LIMIT`, `429 VECTOR_BUSY`               |
| GET/POST     | `/api/v1/memories`                       | Listar `?projectId=` / guardar `{ projectId, content, kind?, scope?, sessionId? }`                           |
| POST         | `/api/v1/memories/search`                | Recuperar `{ projectId, query, includeOrganization?, sessionId? }`                                           |
| PATCH/DELETE | `/api/v1/memories/:id`                   | Actualizar / eliminar                                                                                        |

Con `packageName`, crear conocimiento exige poder publicar en su namespace; sin él (compartido con todo el servidor), poder publicar en todos.

### Agentes, ejecuciones y workers

| Método   | Ruta                                 | Uso                                                                      |
| -------- | ------------------------------------ | ------------------------------------------------------------------------ |
| GET      | `/api/v1/agents`                     | Versiones de agentes publicados                                          |
| GET      | `/api/v1/capabilities[?capability=]` | `builtin` (herramientas integradas) y `contracts` por paquete            |
| POST     | `/api/v1/agents/compose`             | `{ projectId, name, range?, overrides? }` → bundle con digest            |
| GET/POST | `/api/v1/runs`                       | Listar `?projectId=` / encolar composición + `{ task, idempotencyKey? }` |
| GET      | `/api/v1/runs/:id`                   | Definición fijada, estado y resultado                                    |
| POST     | `/api/v1/runs/:id/cancel`            | Cancelar                                                                 |
| POST     | `/api/v1/worker/claim`               | `{ projectId }` → `{ claimed: { run, leaseToken } }` o `null`            |
| POST     | `/api/v1/worker/runs/:id/heartbeat`  | Renovar `{ leaseToken }`                                                 |
| POST     | `/api/v1/worker/runs/:id/finish`     | `{ leaseToken, result }` o `{ leaseToken, error }`                       |

Cada tarea conserva el bundle del momento de envío. El lease dura 60 segundos y se renueva; al vencer otra instancia puede reclamarla (máximo tres intentos) y un lease viejo no puede finalizarla.

### Administración

| Método   | Ruta                              | Uso                                                               |
| -------- | --------------------------------- | ----------------------------------------------------------------- |
| GET      | `/api/v1/admin/audit`             | Eventos de auditoría                                              |
| GET/POST | `/api/v1/admin/export`, `/import` | Backup portable; importar es todo o nada                          |
| POST     | `/api/v1/admin/prune`             | `{ memoryDays?, auditDays?, dryRun? }`; sin cuerpo, 365 y 90 días |

## Operación

- Backups: `deploy/backup.sh` (en caliente, con Compose) o `modai admin export backup.json`; restaurar con `modai admin import backup.json`. El snapshot excluye API keys, secretos y vectores (se recalculan desde el cliente).
- Retención: `modai admin prune --memory-days 365 --audit-days 90 [--dry-run]` o desde el panel.
- Logs HTTP estructurados: `docker compose -f deploy/compose.yaml logs -f server`.
- Una sola réplica: la alta disponibilidad requiere otro diseño de almacenamiento.

## Desarrollo

Con Node `>=26.13.0 <27`, desde la raíz del repositorio:

```bash
npm ci && npm run build
MODAI_API_TOKEN=local-dev-token MODAI_ADMIN_USERNAME=admin MODAI_ADMIN_PASSWORD='cambia-esta-clave' npm run dev
```

La API arranca con recarga en <http://127.0.0.1:8787> y el panel en `/admin`. Para editar el panel en paralelo, `npm run dev:admin`. Los datos quedan en `apps/server/var/`; para empezar de cero, bórrala con el servidor detenido. Pruebas: `npm test` y `npm run test:ui`.

```text
src/
  main.ts            proceso y variables de entorno (config.ts)
  entrypoint.ts      arranque del contenedor: propiedad de volúmenes y baja de privilegios
  app.ts             crea Fastify y registra la infraestructura y los módulos
  infrastructure/    base de datos (Kysely, dialectos, migraciones, búsqueda), artefactos y HTTP (errores, seguridad, sesión, CSRF, assets del panel)
  modules/           un módulo por dominio: auth, organizations, namespaces, projects, packages, categories,
                     knowledge, memory, agents, runs y admin; cada uno con routes, service, repository y schemas
test/                pruebas de la API; test/support con la base de datos de pruebas
```

El panel es una aplicación aparte ([`apps/admin`](../admin/README.md)) que el servidor sirve ya compilada desde `apps/admin/dist`.
