# ADR 003: composición central y ejecución explícita de agentes

Estado: aceptada.

Los paquetes aportan agentes (`contributes.agents`) cuyas `capabilities` nombran herramientas integradas de MODAI (`modai_search_knowledge`, `modai_recall`, `modai_remember`) o servidores MCP de `contributes.mcpServers`. Un bundle resuelto contiene definición, dependencias con versiones exactas, instrucciones verificables, herramientas seleccionadas, permisos y un digest. La ejecución reutiliza la definición y abre una sesión independiente por tarea.

La API conserva catálogo, proyectos, contexto y cola. El cliente independiente aplica adaptadores de archivos y expone herramientas mediante un puente MCP stdio. Las herramientas integradas usan el SDK; los procesos MCP se activan mediante autorizaciones del operador (`--allow-mcp`, `--allow-env`) externas al paquete.

La ejecución inicial usa Ollama local. La inferencia también puede ocurrir en otro equipo mediante un worker, separado del servidor HTTP. No hay acceso implícito a repositorios, shell, modelos cloud o secretos. Un worker necesita clave propia con proyectos asignados, modelo local y confianza en los publicadores.

La cola persiste bundles y resultados. Usa leases renovables y rechaza resultados de workers que perdieron su asignación. La entrega es al menos una vez: los efectos externos requieren idempotencia a cargo de los servidores MCP.

La memoria organizacional necesita autorización adicional explícita.

La base SQLite se conserva. Los embeddings nuevos se guardan en BLOB y el ranking de la API se calcula fuera del event loop sobre un conjunto limitado. Un índice ANN distribuido y la federación entre servidores quedan fuera de esta implementación.
