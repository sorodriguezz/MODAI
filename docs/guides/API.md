# API v1

Base URL local: `http://localhost:8787/api/v1`.

La API requiere `Authorization: Bearer <token>` cuando existe un token bootstrap o una API key activa. `/health` y el HTML de `/admin` son públicos; los datos del panel requieren autorización. Sin credenciales configuradas se habilita el modo local inicial.

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
| GET | `/api/v1/session` | Identidad, rol y modo local de la conexión |
| GET/POST | `/api/v1/admin/api-keys` | Listar/crear API keys |
| POST | `/api/v1/admin/packages/deprecate` | Deprecar una versión |
| POST | `/api/v1/admin/packages/yank` | Retirar una versión |
| GET/POST | `/api/v1/admin/export`, `/import` | Backup portable |
| GET | `/api/v1/admin/audit` | Auditoría |
| GET | `/metrics` | Métricas Prometheus |

Ejemplo de resolución:

```sh
curl -X POST http://localhost:8787/api/v1/resolve \
  -H "content-type: application/json" \
  -d '{"packages":[{"name":"@profiles/backend-architect","range":"^1.0.0"}]}'
```
