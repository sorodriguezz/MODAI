# ADR 002: modelos e inferencia en el cliente

Estado: aceptada en 0.3.0.

MODAI sirve paquetes, archivos, conocimiento y memoria a clientes con modelos locales. El contenedor no aloja runtimes de modelos, no solicita inferencia a Ollama y no genera embeddings. La búsqueda por texto sigue usando SQLite FTS5.

Se eliminan InferenceService, las variables MODAI_OLLAMA_* y las rutas /inference/* y /knowledge/vectors/reindex. Para la búsqueda semántica opcional, el cliente envía embeddings ya calculados, identificados por modelo; el servidor los almacena y compara por similitud coseno. Esto no carga ni ejecuta modelos en Docker.

El paquete @adapters/ollama solo distribuye configuración para el runtime del equipo cliente. No es un servicio Docker.

En 0.5, ADR-003 añade un worker opcional en un proceso separado con su propio runtime. La API HTTP conserva este límite y no aloja modelos.
