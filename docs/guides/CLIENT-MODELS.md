# Modelos y embeddings del cliente

## Responsabilidades

La CLI y el servidor MCP se ejecutan en el equipo cliente. El ejecutor de agentes y el worker opcional también consultan su Ollama local. El servidor Docker no importa el código de `packages/cli/src/client/`, no conoce la URL del runtime y no solicita inferencia.

El flujo es: servidor entrega documentos → cliente calcula embeddings con su runtime local → servidor almacena los vectores. Al buscar: cliente convierte la pregunta en un vector → servidor compara vectores y devuelve documentos.

El diagnóstico de hardware no se envía al servidor. Los documentos se procesan en el cliente y los vectores se suben al registro con la API key de MODAI. El runtime solo acepta direcciones HTTP de loopback (`localhost`, `127.0.0.1`, `[::1]`), sin credenciales ni redirecciones. Se rechazan los tags cloud y los modelos declarados remotos por el runtime; los runtimes y alias locales deben estar bajo tu control.

## Preparación

Instala [Ollama desde su distribución oficial](https://ollama.com/download) en el equipo cliente e inicia la aplicación. No lo añadas al Compose de MODAI. En equipos ARM verifica la disponibilidad del runtime para tu arquitectura y SO; el diagnóstico no instala runtimes, drivers ni capas de emulación.

```sh
modai client doctor
modai client setup --download
```

`doctor` funciona sin estar conectado al registro. Muestra arquitectura física cuando puede detectarla, arquitectura del proceso Node, CPU, memoria disponible, GPU y estado del runtime local. En Windows usa CIM; en macOS, sysctl y system_profiler; en Linux, lspci si está disponible. Consulta nvidia-smi cuando existe para obtener VRAM disponible, evitando el límite del campo AdapterRAM de Windows.

`setup` comprueba el runtime y el modelo antes de guardar configuración. Sin `--download` solo utiliza modelos ya instalados. Con `--download` descarga el modelo elegido, muestra progreso y genera un embedding de prueba. El modelo de chat solo se descarga al añadir `--with-chat`.

```sh
modai client setup --preference quality --download
modai client setup --embedding-model qwen3-embedding:0.6b --download
modai client setup --embedding-model embeddinggemma:300m --download
modai client setup --url http://127.0.0.1:11434 --download --with-chat
```

La configuración se guarda en `~/.modai/local-models.yaml`, fuera de los repositorios. Incluye URL local, modelo de embeddings, digest de sus pesos, tamaño de lote y recomendación de chat. No incluye el inventario de hardware. La conexión y el token del registro se gestionan por separado con `modai connect`.

## Criterio de selección

La política es una **heurística de arranque**, no una garantía de rendimiento o calidad. Reserva al menos la mitad de la RAM total para el resto del sistema y descuenta 1,5 GiB de la memoria libre observada. El presupuesto es el menor de esos dos límites; con menos de 1,5 GiB de presupuesto recomienda liberar memoria o usar búsqueda de texto. La memoria libre cambia durante el uso.

| Equipo o condición | Tratamiento |
|---|---|
| CPU, Mac Intel o GPU sin memoria verificable | Embedding pequeño `embeddinggemma-2:270m`, un fragmento por petición. |
| Apple Silicon con recursos | Candidato `qwen3-embedding:0.6b`; no suma RAM y VRAM, porque comparten memoria. |
| NVIDIA con VRAM libre verificada | Puede aumentar modelo y lote; el runtime debe confirmar el offload efectivo. |
| AMD o Intel GPU | No deduce capacidad por marca ni por memoria compartida; deja que el runtime resuelva ROCm/Vulkan y usa presupuesto conservador. |
| Windows ARM / Qualcomm | Detecta arquitectura y GPU, pero no presupone CUDA, ROCm ni aceleración de NPU. Requiere un runtime compatible disponible para ese equipo. |
| Preferencia `quality` con presupuesto suficiente | Candidato `qwen3-embedding:4b`; requiere al menos 8 GiB de presupuesto RAM y aceleración candidata con recursos. |

Con recursos suficientes, el lote aumenta hasta cuatro fragmentos. Ante un error del lote, la indexación reintenta los fragmentos individualmente; si también fallan se detiene y permite corregir la causa. Nunca cambia de modelo durante una indexación.

Para chat sugiere un tamaño explícito de Qwen 3.5 entre 0.8B y 9B según el presupuesto. Es una propuesta para configurar tu agente: MODAI no inicia chats ni servidores de modelos. El límite de contexto y la convivencia con otros modelos afectan al consumo real.

La política se basa en las distribuciones oficiales de [EmbeddingGemma 2](https://ollama.com/library/embeddinggemma-2), [Qwen3 Embedding](https://ollama.com/library/qwen3-embedding) y [Qwen 3.5](https://ollama.com/library/qwen3.5). Los tamaños de descarga no equivalen a RAM/VRAM necesaria. Se usan tags de tamaño explícito para evitar descargar accidentalmente el modelo más grande marcado como `latest`.

Para runtimes anteriores que no soportan EmbeddingGemma 2, actualiza Ollama o selecciona manualmente [EmbeddingGemma 300M](https://ollama.com/library/embeddinggemma). Los modelos y sus requisitos pueden cambiar; comprueba sus licencias antes de distribuirlos.

## Comprobar el rendimiento real

```sh
modai client benchmark --models embeddinggemma:300m,qwen3-embedding:0.6b
```

Usa exclusivamente modelos instalados. Separa la primera llamada —que puede incluir carga— de tres llamadas posteriores con textos breves. Muestra latencias y dimensiones; no cambia tu configuración ni descarga candidatos.

Evalúa también preguntas representativas de tu proyecto y verifica si los resultados esperados aparecen. Un modelo más rápido en esta prueba no necesariamente recupera mejor tus documentos. `doctor` y `setup` muestran `/api/ps`: `size_vram` es evidencia de memoria usada en aceleración por modelos cargados, no una certificación completa del backend.

## Indexar y buscar

Conecta primero la CLI al registro. Necesitas `publisher` o `admin` para subir vectores; `reader` basta para buscarlos cuando ya están indexados.

```sh
modai embed index
modai embed index --package @skills/design-patterns
modai embed search "cuándo elegir Strategy frente a State"
```

La indexación pagina todo el conocimiento disponible, o filtra por el paquete solicitado. Los documentos se fragmentan por caracteres Unicode, con solapamiento, y se procesan en lotes. Se usa `truncate: false` para que el runtime avise en vez de cortar silenciosamente la entrada. Esta versión agrega los fragmentos en un centroide normalizado por documento: recupera documentos completos, no pasajes individuales. Para documentos extensos, separarlos por tema suele mejorar precisión.

El espacio vectorial incluye el nombre del modelo, su digest y la versión del preprocesamiento. Cambiar pesos o modelo crea otro espacio; los índices anteriores no se sobrescriben. Se verifica el digest antes de indexar y buscar. Si cambia, repite setup e indexación.

El servidor valida un hash del texto antes de aceptar cada vector; si un documento cambia durante el cálculo, responde `DOCUMENT_CHANGED` y debes indexar otra vez. Las ediciones manuales invalidan sus vectores anteriores. El hash y el espacio no contienen inventarios de hardware ni claves.

Si la operación se interrumpe, puedes repetir `modai embed index`: las escrituras por documento y espacio son idempotentes. Esta versión vuelve a calcular también documentos ya indexados; no tiene caché incremental. Los snapshots portables no incluyen vectores: se reconstruyen desde los documentos con el cliente, o se conservan mediante backup del volumen SQLite.

## Uso desde MCP

Después de preparar e indexar este cliente, el agente dispone de `modai_semantic_search`. El proceso MCP genera el embedding en el runtime de este equipo y consulta MODAI. Si hay proyecto inicializado, filtra a sus paquetes instalados; si no, busca en el catálogo indexado accesible.

La búsqueda de texto `modai_search_knowledge` sigue funcionando sin runtime y sin modelos. No se descargan modelos cuando el agente llama a las herramientas MCP.

## Compatibilidad y diagnóstico

- [Ollama para macOS](https://docs.ollama.com/macos): Apple M con CPU/GPU; Mac Intel con CPU. Verifica la versión de macOS requerida.
- [Ollama para Windows](https://docs.ollama.com/windows): NVIDIA y AMD dependen de drivers y backend disponibles. ARM requiere verificar el soporte del runtime para esa distribución.
- [Hardware y GPU](https://docs.ollama.com/gpu): compatibilidad de NVIDIA, ROCm, Metal y Vulkan. No se activa ni modifica un driver desde MODAI.
- [API de embeddings](https://docs.ollama.com/api/embed) y [modelos cargados](https://docs.ollama.com/api/ps): contratos usados por el cliente.

Si no responde Ollama, inicia el runtime local. Si falta un modelo, usa setup con `--download`. Ante falta de memoria, cierra otros modelos, selecciona uno menor y vuelve a indexar. La búsqueda de texto permanece disponible aunque tu equipo no tenga un runtime compatible.
