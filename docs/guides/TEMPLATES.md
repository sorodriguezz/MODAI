# Templates de proyecto

Un **template** es un proyecto completo para empezar con la estructura del equipo, por ejemplo *NestJS con SDD*: carpetas, configuración, `AGENTS.md`, `modai.yaml`, pruebas de ejemplo. Se publica en el servidor con un nombre `@namespace/nombre`, cada versión es inmutable y se usa para crear proyectos nuevos.

Siguen los mismos permisos que los paquetes: publicar exige poder publicar en el namespace, y los templates de un namespace *restringido* solo los ve quien tiene acceso a él.

## Publicar

Desde una carpeta (o un `.zip`):

```sh
modai template publish ./nestjs-sdd --name @plantillas/nestjs-sdd@1.0.0 \
  --description "API NestJS con Spec-Driven Development, pruebas y CI" \
  --stack "NestJS 11 · SDD · PostgreSQL" --tags backend,api,sdd
```

Nunca se incluyen `node_modules`, `.git`, `dist`, `build`, `coverage` ni archivos `.env` (sí `.env.example`). Máximo 25 MiB.

En el panel: **Biblioteca → Templates → Subir template** (archivo `.zip` o carpeta, datos, revisión). Desde el detalle de un template se publica la **nueva versión**, se **descarga el .zip** o se **retira** una versión (deja de ser la última, pero sigue disponible por versión exacta).

## Usar

```sh
modai template list
modai template use @plantillas/nestjs-sdd ./mi-servicio --var owner=equipo-pagos
modai template use @plantillas/nestjs-sdd@1.0.0 ./otro          # versión exacta
modai template download @plantillas/nestjs-sdd mi-plantilla.zip   # sin reemplazar marcadores
```

`use` crea la carpeta (si existe y no está vacía, exige `--force`) y reemplaza los marcadores `{{clave}}` en rutas y archivos de texto. `{{projectName}}` vale el nombre de la carpeta destino; el resto se pasa con `--var clave=valor`. Los marcadores sin valor se dejan tal cual.

## API

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/v1/templates?q=` | Última versión activa de cada template visible |
| GET | `/api/v1/template?name=&version=` | Detalle, versiones y lista de archivos |
| GET | `/api/v1/template/files?name=&version=` | Archivos (base64 + sha256), lo que usa la CLI |
| GET | `/api/v1/template/download?name=&version=` | ZIP |
| POST | `/api/v1/templates` | Publicar `{ name, version, description, stack?, tags?, archive? (ZIP base64) \| files? }` |
| PATCH | `/api/v1/templates` | Retirar o restaurar `{ name, version, status: "yanked" \| "active" }` |
