# Templates de proyecto

Un **template** es un proyecto completo para empezar con la estructura del equipo, por ejemplo *NestJS con SDD*: carpetas, configuración, `AGENTS.md`, `modai.yaml`, pruebas de ejemplo. Es un **paquete** de `kind: Template`: se publica con un nombre `@namespace/nombre`, cada versión es inmutable, aparece en el catálogo de **Paquetes** (pestaña *Templates*) y se usa para crear proyectos nuevos. No se instala en un proyecto: `modai add` o una dependencia hacia un template falla con `TEMPLATE_NOT_INSTALLABLE`.

Como cualquier paquete, publicar exige poder publicar en el namespace (que debe existir), los de un namespace *restringido* solo los ve quien tiene acceso a él, y una versión se depreca o retira con `modai package deprecate|yank` o desde la pestaña *Versiones* de su detalle.

## Publicar

Desde una carpeta (o un `.zip`):

```sh
modai template publish ./nestjs-sdd --name @plantillas/nestjs-sdd@1.0.0 \
  --description "API NestJS con Spec-Driven Development, pruebas y CI" \
  --category backend --tags nestjs,postgres,sdd
```

Nunca se incluyen `node_modules`, `.git`, `dist`, `build`, `coverage` ni archivos `.env` (sí `.env.example`). Máximo 25 MiB. Si el `.zip` envuelve todo en una carpeta, esa carpeta se quita. La categoría es `template` si no se indica; las etiquetas van en `metadata.keywords`.

En el panel: **Paquetes → Crear paquete → Template de proyecto** (o **Crear paquete** con la pestaña *Templates* activa). Los pasos son archivos (editor, `.zip` o carpeta), datos, **opciones** (las features, ver abajo) y revisión. Desde el detalle de un template se publica la **nueva versión** (parte de sus archivos y opciones) y se **descarga el .zip**.

## Usar

```sh
modai template list
modai template use @plantillas/nestjs-sdd ./mi-servicio --var owner=equipo-pagos
modai template use @plantillas/nestjs-sdd@1.0.0 ./otro          # versión exacta
modai template download @plantillas/nestjs-sdd mi-plantilla.zip   # sin reemplazar marcadores
```

`use` crea la carpeta (si existe y no está vacía, exige `--force`) y reemplaza los marcadores `{{clave}}` en rutas y archivos de texto. `{{projectName}}` vale el nombre de la carpeta destino; el resto se pasa con `--var clave=valor`. Los marcadores sin valor se dejan tal cual.

## Features: armar un proyecto por capas

Un template puede ofrecer **features** opcionales que se activan con flags al usarlo, para ir armando el proyecto de forma modular: `modai template use @eq/springboot ./api --sdd --x-lib`.

El autor las declara en `modai.template.yaml`, en la raíz del template (ese archivo no se copia al proyecto):

```yaml
features:
  sdd:
    description: Spec-Driven Development (AGENTS.md, specs/ y verificación)
    path: features/sdd            # carpeta del template cuyos archivos se superponen al proyecto
    vars: { specsDir: specs }     # valor por defecto de {{specsDir}} mientras esté activa
    uses: "@eq/sdd-addon@1.0.0"   # add-on externo que se aplica antes de la carpeta (opcional)
    packages:                     # paquetes MODAI que se añaden al modai.yaml del proyecto nuevo
      "@methodologies/sdd": "^1"
      "@components/health-module": { version: "^1.1", features: [nestjs, metrics] }
  x-lib:
    description: Integración con la librería X
    path: features/x-lib
    requires: [lombok]            # se activa junto con ella
  lombok:
    description: Lombok
    path: features/lombok
    default: true                 # activa salvo --no-lombok
    conflicts: [legacy]           # no se puede combinar con "legacy"
```

- **Base**: todo lo que no está en el manifiesto ni en una carpeta de feature. Se crea siempre.
- **Capas**: primero la base, luego cada feature activa en el orden del manifiesto (su add-on y después su carpeta) y por último los `--with`. Un archivo de una capa posterior reemplaza al anterior; la CLI avisa cuántos fueron reemplazados.
- **Flags**: `--sdd` activa una feature, `--no-lombok` apaga una que viene activa. Los nombres van en minúsculas (`x-lib`), no pueden empezar por `no-` ni llamarse como una opción de la CLI (`var`, `force`, `with`, `help`, `dry-run`…). Una opción desconocida falla y lista las que el template ofrece.
- **Ayuda**: `modai template use @eq/springboot --help` muestra las opciones que **ese** template declara, con su descripción, si vienen activas y qué requieren. `modai template info` y el detalle del panel las muestran también; en el panel se marcan y arman el comando.
- **Add-ons**: un template puede ser una capa para otros. Declara `addon: { for: ["@eq/springboot"] }` en su manifiesto (sin `for` sirve para cualquiera) y se aplica con `--with @eq/sdd-addon[@versión]`. Solo cuenta su base (las features de un add-on no se usan).
- **Validación**: al publicar, el servidor rechaza un manifiesto cuyas carpetas no existen, con features que se requieren en ciclo, se oponen a sí mismas o tienen defaults incompatibles.
- **Paquetes**: `packages` añade paquetes MODAI (con sus features, si se indican) al `modai.yaml` del proyecto nuevo; si el template no trae uno, se crea apuntando al servidor conectado. Se instalan con `modai sync` dentro de la carpeta, o en el mismo paso con `--sync` (y `--allow project.source` si instalan código). Así `--sdd` no solo copia archivos: instala la metodología.
- Las reglas de nombres, `default`, `requires` y `conflicts` son las mismas que las de las [features de paquetes](../spec/PACKAGE-SPEC-v1.md#features-specfeatures).
- `--dry-run` muestra los archivos que se crearían (y lo que se añadiría a `modai.yaml`) sin escribir nada.
- **En el panel**, el paso *Opciones* del editor crea y edita las features sin escribir YAML: nombre, descripción, si viene activa, carpeta, qué otras activa o excluye, marcadores, add-on y paquetes (elegidos por namespace, paquete y versión). Al publicar genera `modai.template.yaml`. Si no tocas las opciones, se respeta el `modai.template.yaml` que traigan los archivos.

## API

Un template es un paquete: se lista con `GET /api/v1/packages/catalog?type=templates`, se lee con `GET /api/v1/package` y sus archivos con `GET /api/v1/artifacts/:id`. Además:

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/v1/packages/import-template` | Publicar `{ name, version, description, category?, keywords?, declaration?, archive? (ZIP base64) \| files? }`. `declaration` (`{ features, addon? }`) reemplaza el `modai.template.yaml` de los archivos |
| GET | `/api/v1/packages/template?name=&version=` | Opciones (`features`, `addon`) y lista de archivos de una versión |
| GET | `/api/v1/packages/download?name=&version=` | ZIP de cualquier paquete (un template se descomprime como la carpeta del proyecto) |
