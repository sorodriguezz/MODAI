# Operación y administración

## Ciclo de paquetes

```sh
modai package scaffold ./capacidad --name @skills/capacidad --type skill
modai package validate ./capacidad
modai package publish ./capacidad
modai package deprecate @skills/capacidad@0.1.0 --message "usa 0.2.0"
modai package yank @skills/capacidad@0.1.0 --reason "defecto crítico"
```

Las versiones son inmutables. `deprecated` sigue resolviendo; `yanked` queda fuera de nuevas resoluciones. La eliminación física requiere primero yank y luego `unpublish --confirm`.

Deprecar y retirar lo puede hacer la administración global o la de la organización dueña del namespace (`org-admin`); eliminar definitivamente, solo la global.

## Todo desde la CLI

La misma CLI gestiona lo que se ve en el panel. Cada comando respeta los permisos de la credencial conectada (`modai server whoami` los muestra).

```sh
# Skills: .skill, .zip o carpeta con SKILL.md
modai skill publish ./code-review --namespace @skills [--skill-version 1.2.0] [--dry-run]
modai skill list
modai skill export @skills/code-review ./code-review.skill

# Templates de proyecto (ver TEMPLATES.md)
modai template publish ./nestjs-sdd --name @plantillas/nestjs-sdd@1.0.0 --description "…"
modai template info @plantillas/nestjs-sdd
modai package yank @plantillas/nestjs-sdd@1.1.0 --reason "…"   # un template es un paquete
modai template use @plantillas/nestjs-sdd ./mi-api

# Conocimiento compartido del servidor
modai knowledge add --title "Guía de despliegue" --file guia.md --tags deploy
modai knowledge list --manual
modai knowledge update <id> --file guia.md
modai knowledge remove <id>

# Memoria: del proyecto actual (modai.yaml) o de cualquier proyecto del servidor con --project
modai memory add "Las fechas van en UTC" --kind decision --project mi-api
modai memory import decisiones.md --project mi-api      # JSON, JSONL o viñetas Markdown
modai memory export memorias.jsonl --project mi-api

# Usuarios, API keys, organizaciones y namespaces
modai admin users
modai admin create-user ana --password '…' --role publisher --organizations ORG --projects mi-api --scopes @skills
modai admin update-user <id> --disable                  # --enable, --role, --password, listas de accesos
modai admin keys && modai admin revoke-key <id>
modai admin organizations && modai admin update-organization <id> --description "…"
modai admin namespaces && modai admin update-namespace @skills --organization ORG --restricted
modai admin audit --limit 50
```

## Identidad

`MODAI_API_TOKEN` es el token bootstrap de administrador. Desde él crea tokens acotados:

```sh
modai admin create-user ci-bot --password '…' --role worker --organizations ORG --projects ID
modai admin create-key --label worker-ci --owner ci-bot --role worker        # dentro de los permisos de ci-bot
modai admin create-key --label instalacion --role admin --service            # sin dueño, solo para automatizar la instalación
modai server keys                                                            # tus keys
```

Cada API key pertenece a un usuario y nunca supera sus permisos (ver [ADMIN-PANEL.md](ADMIN-PANEL.md)). Las personas crean las suyas en el panel, en **Mis API keys**.

Un token se muestra una sola vez y solo se almacena su SHA-256. Los roles son reader, publisher, worker, org-admin y admin. Worker y publisher tienen funciones distintas; ambos leen contexto autorizado, pero worker no publica paquetes. Asigna proyectos, organizaciones y namespaces explícitos con `--projects`, `--organizations` y `--scopes`.

## Backup y retención

```sh
modai admin export ./modai-backup.json
modai admin import ./modai-backup.json
modai admin prune --memory-days 365 --audit-days 90
modai admin prune --audit-days 30 --dry-run     # solo cuenta; cada opción depura solo lo suyo
```

El snapshot incluye paquetes, artefactos, conocimiento manual, memorias, confianza de publicadores, proyectos, organizaciones, namespaces, templates y ejecuciones; excluye API keys y secretos. Conserva además backups de los volúmenes `modularai_modai-data` y `modularai_modai-artifacts` antes de actualizaciones mayores.

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
