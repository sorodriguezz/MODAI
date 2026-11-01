# Operación y administración

## Ciclo de paquetes

```sh
modai package scaffold ./capacidad --name @skills/capacidad --type skill
modai package validate ./capacidad
modai publish ./capacidad
modai deprecate @skills/capacidad@0.1.0 --message "usa 0.2.0"
modai yank @skills/capacidad@0.1.0 --reason "defecto crítico"
```

Las versiones son inmutables. `deprecated` sigue resolviendo; `yanked` queda fuera de nuevas resoluciones. La eliminación física requiere primero yank y luego `unpublish --confirm`.

## Identidad

`MODAI_API_TOKEN` es el token bootstrap de administrador. Desde él crea tokens acotados:

```sh
modai admin create-key --label desarrollador --role publisher
modai admin create-key --label agente-lectura --role reader
```

Un token se muestra una sola vez y solo se almacena su SHA-256. Los roles son jerárquicos: reader < publisher < admin.

## Backup y retención

```sh
modai admin export ./modai-backup.json
modai admin import ./modai-backup.json
modai admin prune --memory-days 365 --audit-days 90
```

El snapshot incluye paquetes, artefactos, conocimiento manual, memorias y confianza de publicadores; excluye API keys y secretos. Conserva además backups de los volúmenes `modularai_modai-data` y `modularai_modai-artifacts` antes de actualizaciones mayores.

## Observabilidad

- `/health`: liveness.
- `/metrics`: formato Prometheus, requiere reader.
- `/api/v1/admin/audit`: mutaciones y actor.
- `docker compose -f deploy/compose.yaml logs -f server`: logs HTTP estructurados, desde la raíz del repositorio.
- `/admin`: panel del registro, conocimiento, keys, auditoría y exportación.

## LAN y TLS

El compose base escucha solo en loopback. Configura el token y hostname en `deploy/.env`. Para HTTP por LAN cambia `MODAI_BIND_IP=0.0.0.0`; para HTTPS interno usa Caddy. Desde la raíz del repositorio:

```sh
docker compose -f deploy/compose.yaml -f deploy/compose.lan.yaml up -d --build
```

Caddy publica `https://HOST:8443` usando su CA interna. Distribuye esa CA únicamente a clientes autorizados.
