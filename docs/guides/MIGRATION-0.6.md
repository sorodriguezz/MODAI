# Migración a 0.6

0.6 implementa [ADR-004](../architecture/ADR-004-package-platform.md): MODAI pasa de ser un servidor con CLI a un **Core de paquetes y capacidades** que funciona sin servidor. El servidor central sigue disponible como registry privado, memoria compartida, panel y ejecución de agentes.

## Qué sigue funcionando sin cambios

- Paquetes publicados con `schemaVersion: 1`: se aceptan, se instalan y se normalizan a v1 al leerse.
- Desde 0.8.0 los proyectos con `.modai/manifest.yaml` ya no se operan directamente: conviértelos con `modai migrate` (también los que tenían un agente activado; vuelve a activarlo después con `modai agent activate`).
- API HTTP v1, API keys, workers, MCP de proyectos 0.5 y backups.

## Qué cambia

| Antes (0.5) | Ahora (0.6) |
|---|---|
| `modai init` creaba un proyecto ligado al servidor | `modai init` crea `modai.yaml` y no exige servidor. El formato anterior ya no se crea; los proyectos existentes se convierten con `modai migrate`. |
| `.modai/manifest.yaml` + `.modai/lock.yaml` | `modai.yaml` + `modai.lock` en la raíz, con `integrity` por paquete |
| `type` cerrado | `kind` (`Package`, `Profile`, `Adapter`) + `category` libre + `provides`/`requires` |
| `modai registry --query x` | `modai registry packages --query x`; `registry add/list/remove` gestionan registries |
| `modai package scaffold --type skill` | `modai package scaffold --kind package --category …` (v1); `--type` sigue creando un paquete 0.5 |
| Bindings de herramientas del operador | Las herramientas viajan en el paquete y se habilitan con `modai grant` |
| `GET /api/v1/capabilities` → `{ capabilities }` | Añade `contracts` (provides/requires/tools); filtro `?capability=` |
| `POST /api/v1/resolve` | Verifica también capacidades: puede responder `409 CAPABILITY_UNSATISFIED` |

## Convertir un proyecto

```sh
cd mi-proyecto
modai migrate --allow project.instructions
git add modai.yaml modai.lock .modai/.gitignore
```

`migrate` crea `modai.yaml` con el servidor del proyecto como registry `central` y memoria remota (`context.projectId`), sincroniza sin reescribir archivos idénticos y archiva los archivos 0.5 en `.modai/legacy-0.5/`. Si la sincronización falla, los archivos 0.5 quedan intactos y el `modai.yaml` generado se aparta a `.modai/modai.yaml.failed` para revisarlo.

Si el proyecto tenía un agente activado con `modai agent activate`, migra el proyecto y vuelve a activarlo: los agentes funcionan sobre `modai.yaml` vinculado al servidor (`context.projectId`).

## Convertir un paquete

```yaml
# 0.5
schemaVersion: 1
name: "@skills/nestjs"
version: 1.0.0
type: skill
description: ...
files:
  - { source: content/SKILL.md, target: .agents/skills/nestjs/SKILL.md }
```

```yaml
# 0.6
apiVersion: modai.dev/v1
kind: Package
metadata: { name: "@skills/nestjs", version: 1.1.0, description: ... }
spec:
  category: backend
  provides: [backend.nestjs.conventions@1.0.0]
  contributes:
    skills: [{ name: nestjs, path: content }]
```

Con la skill como contribución, cualquier adaptador activo (`.agents/skills`, `.claude/skills`, Cursor…) la materializa; ya no queda atada a una ruta.

## Servidor

Reconstruye la imagen (`docker compose -f deploy/compose.yaml up -d --build`). No hay migraciones de datos para el catálogo: los paquetes existentes se normalizan al leerse. El panel incorpora inicio de sesión con usuario y contraseña; consulta la [guía del panel](ADMIN-PANEL.md).
