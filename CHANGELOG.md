# Cambios

## Sin publicar

- **Componentes de código** (`spec.contributes.components` y permiso `project.source`): paquetes con código propio (módulos de backend, componentes de UI, servicios) que se copian al proyecto de forma reversible; `modai remove` conserva los archivos editados. El índice del agente (`AGENTS.md`/`CLAUDE.md`) los enumera. Ejemplo: `@components/health-module`.
- CLI: `modai list [tipo]` (alias `ls`) para lo instalado o, con `--available`/`--registry`, lo publicado, por contribución (`components`, `skills`, `tools`…), kind (`profiles`) o categoría (`harness`, `backend`…); `modai component create` empaqueta una carpeta de código existente y `modai component list`.
- Panel web: **Crear paquete** y **Editar y publicar nueva versión** desde el navegador (plantillas de componente, harness, skill, conocimiento o vacío; archivos editables y subida de archivos o carpetas; validación de calidad antes de publicar), filtro por tipo y pestaña **Archivos** en el detalle de cada paquete.

## 0.6.0

Implementa [ADR-004](docs/architecture/ADR-004-package-platform.md): MODAI como plataforma de paquetes y capacidades extensibles.

- **Especificación de paquetes v1** (`apiVersion: modai.dev/v1`): `kind` (Package, Profile, Adapter), `category` libre, `provides`/`requires`/`optional`/`conflicts` versionados, permisos ampliados, `contributes` (skills, rules, knowledge, tools, mcpServers, agents, files), `entrypoints`, `include` y `compatibility`. Los manifiestos 0.5 se normalizan al leerse.
- **Nuevo `@modai/core`** independiente del servidor: resolvedor de dependencias y capacidades, registries (`LocalRegistry` de carpeta, `HttpRegistry`, dependencias `file:`), adaptadores declarativos, installer reversible con bloques y entradas JSON administrados, store verificable, Context Gateway BM25 con procedencia y memoria local por ámbito.
- **Proyecto `modai.yaml` + `modai.lock`** con integridad SHA-256 por paquete, lock determinista y `modai sync --frozen`.
- **Instalar no es autorizar**: `modai grant/revoke/permissions`; herramientas de paquetes ejecutadas sin shell, con validación de entrada, límites y entorno mínimo, ligadas a la integridad.
- **Adaptadores** integrados como datos (`agent-skills`, `agents-md`, `claude-code`, `mcp`) y como paquetes (`@adapters/cursor`, `@adapters/opencode`).
- **Gateway MCP v1**: conocimiento por fragmentos, memoria, capacidades, skills como recursos y herramientas/servidores MCP autorizados.
- CLI: `init` sin servidor, `add` múltiple y `file:`, `capabilities`, `providers`, `provider`, `tools`, `context`, `adapter`, `registry add/list/remove/packages`, `publish --registry`, `package scaffold --kind/--category/--with-tool`, `migrate`. `init --legacy` conserva el formato 0.5.
- Servidor: usa el resolvedor y validador del Core, acepta manifiestos v1, `/api/v1/capabilities` expone contratos y filtra por `?capability=`, `/api/v1/packages?name=`; composición de agentes basada en contribuciones, no en tipos.
- Panel web con inicio de sesión por usuario y contraseña, primer administrador protegido por el secreto de arranque, gestión de usuarios y rediseño de la interfaz.
- Paquetes de referencia: `@patterns/frontend-architecture`, `@architecture/decision-records`, `@testing/playwright`, `@testing/regression`, `@profiles/fullstack-quality`.
- Despliegue en Raspberry Pi (`compose.raspberry.yaml`, `npm run docker:pi`, `deploy/backup.sh`), Fly.io (`deploy/fly/fly.toml`, `npm run deploy:fly`) y Railway (`deploy/railway/`); imagen multi-arquitectura en GHCR mediante GitHub Actions. El servidor acepta `PORT` y `MODAI_TRUST_PROXY`; el contenedor ajusta la propiedad de volúmenes y baja privilegios al usuario `node`.
- Pruebas de aceptación: un paquete externo de regresión se crea, publica, instala, conecta por MCP y ejecuta sin modificar el Core.
- Cambios incompatibles: `modai registry --query` pasa a `modai registry packages --query`; `modai init` crea proyectos v1; `POST /api/v1/resolve` puede responder `409 CAPABILITY_UNSATISFIED`.

## 0.5.0

- Nombre público del CLI en npm: `@sorodriguez/modai`; comandos `modai` y `modai-mcp`.

- Web independiente en `apps/admin`, con vistas por sección y assets servidos desde el backend.
- Un único paquete npm del CLI con SDK y contratos incorporados; workspaces internos privados.
- Flujo del panel para seleccionar proyecto, crear credencial individual y entregar comandos CLI/MCP.
- Conexión con entrada oculta o stdin, `whoami`, URL pública anunciada y overlay de dominio/HTTPS.
- Estado local bajo `apps/server/var`, creado al iniciar; eliminadas las carpetas vacías de la raíz.

- Node 26.13.0 unificado en servidor, CLI, MCP, SDK, contratos, workers y Docker.

- Monorepo con servidor, panel y librerías internas separados del cliente distribuible.
- Agentes versionados, activación por adaptadores, herramientas y descubrimiento MCP stdio.
- Ejecución con Ollama local y workers opcionales con leases, cancelación y versiones fijadas.
- Permisos de proyecto, organización y namespace por API key; eliminación del acceso anónimo.
- Instalación con permisos explícitos, protección frente a symlinks y verificación de firmas en el cliente.
- Cuotas, límites de frecuencia, cabeceras de seguridad y búsqueda vectorial acotada fuera del event loop.
- Panel con agentes, proyectos, ejecuciones y modo oscuro seleccionable.
- Backups con proyectos, organizaciones y ejecuciones; guía de migración.

## 0.4.0

- Repositorio organizado: deploy/, scripts/, tests/, docs/architecture/, docs/guides/, src/client/ y var/ para datos de desarrollo.
- README renovado con propósito del producto, arranque Docker, acceso, catálogo, uso en proyectos y operación.
- .gitignore ampliado para credenciales, SQLite, datos, modelos, backups, cachés y archivos del sistema.
- Diagnóstico local de hardware y runtime, selección conservadora de modelos y benchmark de latencia.
- Setup y descargas explícitas de modelos en el cliente; indexación paginada y búsqueda semántica mediante CLI y MCP.
- Vectores separados por modelo/digest con migración que conserva los índices previos y validación del contenido al indexar.
- Los nombres del proyecto Compose y de los volúmenes persistentes se conservan.

## 0.3.0

- Panel responsive renovado: catálogo con filtros, detalle de paquetes, comandos de instalación, editor de conocimiento manual, memoria por proyecto, accesos y actividad.
- El servidor deja de solicitar inferencia y embeddings a Ollama. Los modelos se ejecutan en el cliente.
- Vectores opcionales recibidos del cliente; búsqueda FTS5 disponible sin modelos.
- Adaptador Ollama 1.1.0 con ejecución explícita en el cliente y endpoint localhost. Perfil backend-architect 1.1.0.
- Aplicación, CLI y MCP actualizados a 0.3.0.
- Docker usa Node 26.13.0 en compilación y producción. Versiones para desarrollo en .node-version y .nvmrc.
- Dependencias directas de producción y desarrollo actualizadas a sus versiones estables más recientes; lockfile renovado.
- Build y pruebas de integración se ejecutan como parte de la construcción Docker.

Compatibilidad: se eliminan /api/v1/inference/* y /api/v1/knowledge/vectors/reindex. /api/v1/knowledge/vector-search ahora recibe { model, embedding, limit } en lugar de texto. Los datos y versiones ya publicados se conservan.
