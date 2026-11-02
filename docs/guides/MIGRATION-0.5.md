# Migrar a MODAI 0.5

Conserva los volúmenes y prepara una copia de seguridad antes de actualizar. Las migraciones SQLite son aditivas y mantienen paquetes, memorias y claves existentes.

## Autenticación

El arranque exige `MODAI_API_TOKEN` o una API key admin activa en la base de datos. Se elimina completamente `local-anonymous`; revocar la última clave no abre el servidor. Para recuperar administración usa el token configurado en el entorno.

Las claves existentes conservan su rol, pero sus listas de proyectos, organizaciones y namespaces empiezan vacías. Un administrador debe asignarlas con `modai admin grant-key ID --projects PROYECTO --scopes @skills,@agents`, mediante el panel, con `PATCH /api/v1/admin/api-keys/:id` o emitir claves nuevas mediante el panel o CLI. Los IDs de proyectos ya presentes en memoria se registran automáticamente y quedan accesibles a administradores hasta asignar permisos.

Un proyecto local sin memoria previa puede registrarse conservando su ID con `modai project register`, usando una clave publisher o admin. Otros equipos usan `modai init --project ID` con su propia clave autorizada.

Los ámbitos antiguos que eran etiquetas arbitrarias se conservan como `metadata.legacyScope` y se migran a memoria de proyecto. Las nuevas memorias organizacionales o de sesión requieren organización o sesión explícitas.

## Cliente y rutas

Todos los componentes requieren Node `>=26.13.0 <27`. Los archivos de selección de versión y las imágenes Docker fijan Node 26.13.0.

La CLI vive en `packages/cli`, el SDK en `packages/sdk`, los contratos en `packages/contracts` y el servidor en `apps/server`. Compila con `npm run build`. Los comandos raíz `npm start`, `npm run cli` y `npm run mcp` siguen disponibles.

Distribuye el cliente con `npm run pack:client`; instala el único archivo `dist/npm/sorodriguez-modai-0.5.0.tgz`. No requiere Fastify, SQLite ni clonar el servidor. El CLI todavía necesita publicación para instalarlos por nombre desde el registro público.

Los paquetes que instalan `AGENTS.md`, `CLAUDE.md`, `.agent/` o `.opencode/agents/` deben declarar `project.instructions`. Los destinos `docs/` necesitan `project.files`. Los ejecutables necesitan `process.execute`. Concede los permisos al instalar, por ejemplo:

```sh
modai add @harness/opencode --allow project.instructions
modai add @methodologies/sdd --allow project.files
```

Las versiones publicadas son inmutables: para añadir declaraciones a un paquete existente, publica una versión nueva. Los manifiestos locales del catálogo de ejemplos están actualizados; si ya cargaste una versión anterior con el mismo número, publica la revisión con una versión superior.

Las rutas reservadas y los enlaces simbólicos en rutas administradas se rechazan. No uses symlinks para `.modai` o carpetas de skills instaladas.

## Docker

```sh
docker compose -f deploy/compose.yaml up -d --build
# El catálogo opcional usa ahora una imagen cliente independiente:
docker compose -f deploy/compose.yaml --profile examples run --build --rm seed-examples
```

El servidor runtime instala únicamente sus dependencias y contratos. El perfil de ejemplos construye la imagen `modularai-client:local`. No hay un worker conectado automáticamente; se inicia explícitamente en un equipo con su modelo y clave worker.

Los backups lógicos conservan el formato base `schemaVersion: 1` y ahora incluyen proyectos, organizaciones y ejecuciones. No incluyen API keys ni leases activos. Los proyectos restaurados quedan bajo administración hasta volver a asignar sus claves. Las tareas que estaban ejecutándose se restauran en cola; revisa los efectos externos antes de reanudarlas.

## Panel separado y rutas locales

La web ahora vive en `apps/admin`; ejecuta `npm run build` y reconstruye la imagen para incluir sus assets. La ruta sigue siendo `/admin`. El backend sirve los archivos compilados del panel.

Fuera de Docker, la ubicación predeterminada pasa de `var/` a `apps/server/var/`, sin depender del directorio de arranque. Si tenías una base o artefactos en la ubicación anterior, configura explícitamente `MODAI_DATABASE_PATH` y `MODAI_ARTIFACT_DIR` con sus rutas absolutas antes de arrancar, o migra esos datos con el servidor detenido. Los volúmenes Docker mantienen sus nombres y ubicaciones.
