# API v1

Base URL local: `http://localhost:8787/api/v1`.

La API requiere siempre `Authorization: Bearer <token>`. `/health`, el HTML de `/admin` y sus assets son públicos; los datos del panel requieren autorización. El arranque exige token bootstrap o una clave admin activa. No existe modo anónimo.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/health` | Estado del servicio |
| GET | `/api/v1/packages?q=&type=` | Catálogo |
| GET | `/api/v1/package?name=&version=` | Metadatos de un paquete |
| POST | `/api/v1/packages` | Publicar manifiesto y artefacto inmutable |
| POST | `/api/v1/resolve` | Resolver dependencias transitivas |
| GET | `/api/v1/artifacts/:id` | Descargar archivos con hashes |
| POST | `/api/v1/knowledge/documents` | Añadir conocimiento independiente |
| POST | `/api/v1/knowledge/search` | Buscar con FTS5 y filtro de paquetes |
| POST | `/api/v1/memories` | Guardar memoria |
| GET | `/api/v1/memories?projectId=` | Listar memoria de un proyecto |
| POST | `/api/v1/memories/search` | Recuperar memoria relevante |
| DELETE | `/api/v1/memories/:id` | Eliminar memoria |
| PATCH | `/api/v1/memories/:id` | Actualizar memoria |
| GET | `/api/v1/knowledge/documents?limit=&offset=` | Listar conocimiento paginado; devuelve `nextOffset` o null |
| PATCH/DELETE | `/api/v1/knowledge/documents/:id` | Gestionar conocimiento manual |
| PUT | `/api/v1/knowledge/documents/:id/vector` | Guardar `{ model, embedding, sourceHash? }` generado en el cliente |
| POST | `/api/v1/knowledge/vector-search` | Buscar con `{ model, embedding, limit?, packageNames? }` generado en el cliente |
| GET | `/api/v1/session` | Identidad, rol, grants y `permissions` (qué puede hacer la conexión) |
| GET/POST/DELETE | `/api/v1/me/api-keys[/:id]` | Tus API keys: listar, crear `{ label, role, inherit?, projectIds?, organizationIds?, packageScopes? }` (solo con sesión del panel) y revocar. Nunca superan los permisos de tu usuario |
| GET/POST | `/api/v1/admin/api-keys[?ownerId=]` | Keys de los usuarios que administras; crear con `ownerId` (por defecto, tú). `ownerId: null` crea una key de servicio sin dueño (solo administración global) |
| PATCH | `/api/v1/admin/api-keys/:id` | Ajustar accesos o asignar dueño `{ ownerId?, inherit?, projectIds?, organizationIds?, packageScopes? }` |
| POST | `/api/v1/admin/packages/deprecate` | Deprecar una versión |
| POST | `/api/v1/admin/packages/yank` | Retirar una versión |
| GET/POST | `/api/v1/admin/export`, `/import` | Backup portable |
| POST | `/api/v1/admin/prune` | Retención `{ memoryDays?, auditDays?, dryRun? }`: solo depura los campos presentes (0 = todo); sin cuerpo, 365 y 90 días. `dryRun` cuenta sin borrar |
| POST | `/api/v1/packages/import-skill` | Convierte un `.skill` `{ archive (ZIP base64), namespace, version?, name?, dryRun? }` en un paquete y lo publica; `dryRun` devuelve manifiesto, archivos y calidad |
| GET/POST/PATCH | `/api/v1/templates`, `/api/v1/template*` | Templates de proyecto: ver [TEMPLATES.md](TEMPLATES.md) |
| GET | `/api/v1/admin/audit` | Auditoría |
| GET | `/metrics` | Métricas Prometheus |

Ejemplo de resolución:

```sh
curl -X POST http://localhost:8787/api/v1/resolve \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $MODAI_API_TOKEN" \
  -d '{"packages":[{"name":"@profiles/backend-architect","range":"^1.0.0"}]}'
```

## Proyectos y agentes

| Método | Ruta | Uso |
|---|---|---|
| GET/POST | `/api/v1/projects` | Listar proyectos autorizados (con `canDelete`) / registrar un proyecto propio |
| DELETE | `/api/v1/projects/:id` | Eliminar un proyecto con su memoria, ejecuciones e instalaciones. Cuerpo `{ "confirmation": "<id>" }`; admin o quien lo creó; `409 PROJECT_BUSY` si un worker procesa una tarea |
| PATCH | `/api/v1/admin/api-keys/:id` | Reemplazar grants `{ projectIds, organizationIds, packageScopes }` |
| POST | `/api/v1/admin/publishers` | Registrar `{ publicKey, label, trusted }` |
| GET | `/api/v1/agents` | Listar versiones de agentes |
| GET | `/api/v1/capabilities` | Herramientas integradas de MODAI (`builtin`) y contratos por paquete (`contracts`) |
| POST | `/api/v1/agents/compose` | Resolver `{ projectId, name, range?, overrides? }` a un bundle |
| GET/POST | `/api/v1/runs` | Listar con `?projectId=` / enviar composición más `{ task, idempotencyKey? }` |
| GET | `/api/v1/runs/:id` | Consultar definición fijada, estado y resultado |
| POST | `/api/v1/runs/:id/cancel` | Cancelar una tarea pendiente o en ejecución |
| POST | `/api/v1/worker/claim` | Reclamar `{ projectId }`; devuelve `{ claimed: { run, leaseToken } }` o null |
| POST | `/api/v1/worker/runs/:id/heartbeat` | Renovar `{ leaseToken }` |
| POST | `/api/v1/worker/runs/:id/finish` | Finalizar con `{ leaseToken, result }` o `{ leaseToken, error }` |

## Organizaciones, namespaces y permisos (0.9)

La jerarquía es **organización → proyecto → namespace → paquete**. El rol `org-admin` administra las organizaciones de su `organizationIds`: sus proyectos, sus namespaces y los usuarios y API keys cuyas organizaciones administra (solo puede asignar roles `reader`, `publisher`, `worker` y `org-admin`, proyectos de esas organizaciones y namespaces que les pertenecen). Auditoría, backups, publicadores y deprecar/retirar paquetes siguen siendo de la administración global.

| Método | Ruta | Uso |
|---|---|---|
| GET/POST | `/api/v1/organizations` | Listar (con conteos de proyectos, namespaces y miembros) / crear `{ name, description? }` (solo global) |
| PATCH | `/api/v1/organizations/:id` | Renombrar o describir (global u `org-admin` de esa organización) |
| DELETE | `/api/v1/organizations/:id` | Eliminar una organización vacía. Cuerpo `{ "confirmation": "<nombre>" }`; `409 ORGANIZATION_NOT_EMPTY` si tiene proyectos o namespaces |
| GET/POST | `/api/v1/namespaces` | Listar los visibles / crear `{ name, organizationId?, description?, visibility? }` |
| PATCH/DELETE | `/api/v1/namespaces/:name` | Cambiar organización, descripción o visibilidad / eliminar uno sin paquetes |
| PATCH | `/api/v1/projects/:id` | Renombrar `{ name }` o mover `{ organizationId }` (mover exige administrar ambas organizaciones) |

Un namespace `internal` es visible para cualquier identidad autenticada; uno `restricted` solo para quien lo tenga en `packageScopes` o administre su organización (catálogo, resolución, artefactos, agentes y conocimiento de sus paquetes). Publicar exige el rol de publicación y el namespace asignado (un `org-admin` publica en los namespaces de sus organizaciones). El primer paquete de un namespace desconocido lo registra sin organización.

Las rutas de contexto y tareas verifican el proyecto tanto al consultar como al escribir. Un rol worker no concede publicación de paquetes. La memoria admite `scope: project|organization|session`, `sessionId` y consultas con `includeOrganization`; compartir organización exige grants explícitos. El catálogo y el conocimiento publicado son compartidos entre clientes autenticados; no almacenes documentos privados de un proyecto como conocimiento global.

`GET /health` incluye `apiVersion: 1` y la política de firmas. La búsqueda vectorial puede responder `413 VECTOR_CANDIDATE_LIMIT` o `429 VECTOR_BUSY`; limita los paquetes de la consulta. Las entradas generales se limitan a 1 MiB; publicación usa un límite específico y cada artefacto tiene un máximo decodificado de 25 MiB.

`/health` incluye `publicUrl` cuando se configura `MODAI_PUBLIC_URL`. Esa dirección debe ser un origen HTTP(S), sin credenciales ni prefijo de ruta.

## Paquetes, resolución y sesión del panel

- `POST /api/v1/packages` exige `apiVersion: modai.dev/v1` (si falta, `INVALID_INPUT`). Se validan con el validador del Core (`PERMISSION_UNDECLARED`, `MISSING_SOURCE`, `SKILL_ENTRYPOINT_MISSING`, `UNSAFE_TARGET`, `AGENT_CAPABILITY`, `MEMORY_POLICY`…). La columna `type` de los registros contiene la `category`.
- `GET /api/v1/packages?name=@scope/nombre` filtra por nombre exacto (lo usa `HttpRegistry`).
- `POST /api/v1/resolve` resuelve también capacidades y puede responder `409 CAPABILITY_UNSATISFIED`, `PACKAGE_CONFLICT`, `CAPABILITY_CONFLICT` o `422 INCOMPATIBLE_PLATFORM`/`INCOMPATIBLE_CORE`.
- `GET /api/v1/capabilities[?capability=browser.automation]` devuelve `builtin` (las herramientas integradas que un agente puede seleccionar: nombre, descripción, `readOnly` y `inputSchema`) y `contracts`: `provides`, `requires`, `optional` y herramientas por paquete.
- Sesión del panel (cookie `HttpOnly` + cabecera `x-modai-csrf: 1` en escrituras): `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, `POST /api/v1/auth/password`; usuarios: `GET/POST /api/v1/admin/users`, `PATCH/DELETE /api/v1/admin/users/:id`. Detalle en la [guía del panel](ADMIN-PANEL.md). Las API keys Bearer no cambian.
