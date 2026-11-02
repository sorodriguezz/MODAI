# ADR 003: composición central y ejecución explícita de agentes

Estado: implementada en 0.5.

El catálogo central incorpora paquetes `agent` y capacidades declarativas. Un bundle resuelto contiene definición, dependencias con versiones exactas, instrucciones verificables, herramientas seleccionadas, permisos y un digest. La ejecución reutiliza la definición y abre una sesión independiente por tarea.

La API conserva catálogo, proyectos, contexto y cola. El cliente independiente aplica adaptadores de archivos y expone herramientas mediante un puente MCP stdio. Las herramientas incorporadas usan el SDK; las herramientas locales y procesos MCP se activan mediante autorizaciones del operador y bindings externos al paquete.

La ejecución inicial usa Ollama local. La inferencia también puede ocurrir en otro equipo mediante un worker, separado del servidor HTTP. No hay acceso implícito a repositorios, shell, modelos cloud o secretos. Un worker necesita clave propia con proyectos asignados, modelo local y confianza en los publicadores.

La cola persiste bundles y resultados. Usa leases renovables y rechaza resultados de workers que perdieron su asignación. La entrega es al menos una vez: los efectos externos requieren idempotencia a cargo de los bindings.

Las claves antiguas no reciben acceso global durante la migración. Se mantienen los roles y se añaden grants vacíos para que un administrador asigne cada proyecto y namespace. La memoria organizacional necesita autorización adicional explícita.

La base SQLite se conserva. Los embeddings nuevos se guardan en BLOB y el ranking de la API se calcula fuera del event loop sobre un conjunto limitado. Un índice ANN distribuido y la federación entre servidores quedan fuera de esta implementación.
