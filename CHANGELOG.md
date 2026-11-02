# Cambios

## 0.5.0

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
