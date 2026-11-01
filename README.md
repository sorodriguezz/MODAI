# MODAI · Capacidades compartidas para agentes de IA

MODAI (ModularAI) es un servidor ligero para **publicar, organizar y distribuir skills, harnesses, conocimiento y memoria** entre tus proyectos y agentes. En lugar de copiar instrucciones a mano en cada repositorio, las empaquetas, las versionas y las instalas con la CLI `modai`.

Por ejemplo: publicas una skill de patrones de diseño una vez, la instalas en varios proyectos y permites que sus agentes consulten las mismas guías. Cada proyecto conserva sus propias decisiones en una memoria independiente.

**El servidor no ejecuta modelos.** Docker aloja el registro, la API y el panel web. Ollama u otro runtime, el modelo y el agente se ejecutan en el equipo cliente. La búsqueda de texto funciona sin modelos ni GPU.

```text
Servidor MODAI (Docker)                   Equipo cliente
┌───────────────────────────┐           ┌─────────────────────────────┐
│ Catálogo y archivos       │  CLI      │ Proyecto y archivos locales │
│ Skills y harnesses        │ ◄───────► │ Editor / agente             │
│ Conocimiento y memoria    │  MCP/API  │ Ollama u otro runtime       │
│ Panel de administración   │ ◄───────► │ Modelo local                │
└───────────────────────────┘           └─────────────────────────────┘
```

## Qué puedes hacer

- Componer perfiles con skills, metodologías, harnesses, adaptadores y conocimiento.
- Publicar paquetes inmutables con versiones SemVer, dependencias y verificación SHA-256; firmarlos opcionalmente con Ed25519.
- Instalar y actualizar capacidades en un proyecto, con un lockfile y protección de archivos modificados por el usuario.
- Consultar conocimiento y guardar decisiones por proyecto desde la CLI o un cliente MCP.
- Administrar documentos, API keys, auditoría y backups desde la web y la API.
- Generar y auditar un harness con instrucciones, estado, alcance, verificación y continuidad entre sesiones.

Una **skill** contiene instrucciones para una tarea concreta; un **harness** organiza cómo trabaja un agente; un **perfil** agrupa varios paquetes. Los paquetes de ejemplo son opcionales y el servidor puede funcionar con el catálogo vacío.

## Levantar el servidor con Docker

Necesitas Docker Engine con **Compose v2**, o Docker Desktop, en ejecución. Para levantar solamente el servidor no necesitas instalar Node, Ollama ni modelos en el host. La imagen compila y ejecuta la aplicación con **Node 26.13.0**.

Todos los comandos siguientes se ejecutan desde la raíz de este repositorio, salvo que se indique otra carpeta.

### 1. Configurar el acceso

En PowerShell:

```powershell
cd C:\Users\sebas\Desktop\MODAI
if (-not (Test-Path deploy/.env)) { Copy-Item deploy/.env.example deploy/.env }
notepad deploy/.env
```

En Linux/macOS, copia el archivo con `cp -n deploy/.env.example deploy/.env` y ábrelo con tu editor.

Si ya tienes `deploy/.env`, conserva ese archivo. Reemplaza el token de ejemplo por uno largo y aleatorio:

```dotenv
MODAI_BIND_IP=127.0.0.1
MODAI_PORT=8787
MODAI_API_TOKEN=REEMPLAZAR_POR_UN_SECRETO_PROPIO
MODAI_HOSTNAME=modai.local
```

Compose lee `deploy/.env` automáticamente porque está junto al archivo Compose. Este archivo no se incluye en Git ni en la imagen Docker.

### 2. Construir e iniciar

```sh
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

La primera construcción instala dependencias, compila TypeScript y ejecuta las pruebas. El servicio aparecerá como `healthy` cuando termine el arranque.

Abre [el panel de MODAI](http://127.0.0.1:8787/admin). Pulsa **Conexión**, pega el valor de `MODAI_API_TOKEN` y conecta. El endpoint [de salud](http://127.0.0.1:8787/health) permite comprobar versión y runtime sin autenticación.

Por defecto el puerto solo es accesible desde este PC. Si arrancas sin token y sin API keys activas, MODAI habilita administración local inicial; al configurar credenciales, las operaciones de la API requieren autenticación.

### 3. Cargar los ejemplos

```sh
docker compose -f deploy/compose.yaml --profile examples run --rm seed-examples
```

El proceso publica el catálogo mediante la API utilizando el token de `deploy/.env`. Omite las versiones que ya existen. Después pulsa **Actualizar** en el panel.

Incluye skills de patrones de diseño, creación de skills, harness engineering y NestJS; conocimiento de arquitectura hexagonal; perfiles backend y harness-engineer; SDD, OpenCode, memoria, MCP y configuración de Ollama **para el cliente**.

## Conectar un proyecto y usar sus capacidades

El **equipo cliente** necesita Node 26.13.0 y acceso al servidor. Instala la CLI desde una copia de este repositorio:

```sh
npm ci
npm run build
npm link
modai connect http://127.0.0.1:8787 --token TU_TOKEN
```

Si el servidor está en otro equipo, sustituye `127.0.0.1` por su dirección. Usa una API key propia para cada cliente; el panel permite crearlas con permisos de lectura, publicación o administración.

Ahora entra en el proyecto donde quieres usar las capacidades. Carga primero el catálogo del paso anterior si vas a utilizar estos perfiles de ejemplo:

```sh
cd ruta/a/mi-proyecto
modai init --profile @profiles/harness-engineer
modai status
modai search "cuándo usar Strategy o State"
modai harness init .
modai harness audit .
```

El perfil instala las skills de autoría de harnesses, skills y patrones de diseño, junto con los contratos de memoria y MCP. Los archivos quedan en el proyecto, por ejemplo en `.agents/skills/`; tu agente debe poder leer esa ubicación. **Instalar un paquete no inicia un modelo ni convierte por sí solo el proyecto en un agente.**

También puedes empezar sin perfil y añadir paquetes individualmente:

```sh
modai init
modai add @skills/design-patterns
modai add @knowledge/hexagonal
modai remember "Las reglas de negocio no dependen del framework" --kind decision
modai recall "reglas de negocio"
modai outdated
modai update
```

Ejecuta `modai init` una sola vez por proyecto. Para un proyecto ya inicializado usa `modai add`, incluso para añadir un perfil.

La carpeta `.modai/` conserva el identificador del proyecto, sus dependencias directas y el lockfile con las versiones resueltas. La conexión global de la CLI se guarda en `~/.modai/client.yaml`; el token no se copia al repositorio del proyecto.

Para que un agente consulte contexto y memoria durante sus sesiones, configura el servidor MCP `modai-mcp` en tu cliente. Consulta la [guía MCP](docs/guides/MCP.md). MCP y el runtime de modelos se ejecutan del lado del cliente.

## Embeddings y modelos adecuados para tu equipo

Ejecuta estos comandos **en el cliente donde corre el agente**, con Ollama instalado y en ejecución de forma nativa:

```sh
modai client doctor
modai client setup --download
modai embed index
modai embed search "cómo organizar las responsabilidades del dominio"
```

`doctor` detecta SO, arquitectura, CPU, RAM disponible y GPU cuando puede consultarla. No descarga ni ejecuta modelos. `setup --download` selecciona un modelo según esos recursos, lo descarga en tu Ollama local, comprueba que genera embeddings y guarda la configuración solo en ese equipo. `embed index` lee el conocimiento de MODAI, calcula sus vectores en el cliente y los sube al servidor; requiere permiso de publicación. La búsqueda semántica calcula también el vector de la consulta localmente.

La selección contempla CPU sin GPU dedicada, Mac Intel, Apple Silicon con memoria unificada, Windows ARM y GPUs NVIDIA/AMD/Intel. Detectar una GPU no garantiza que sus drivers o el runtime la aceleren: se reserva memoria para otras aplicaciones y se conserva una alternativa pequeña para CPU. No instala drivers ni modifica el sistema.

Para priorizar calidad en un equipo con recursos o elegir manualmente:

```sh
modai client setup --preference quality --download
modai client setup --embedding-model embeddinggemma:300m --download
modai client benchmark --models embeddinggemma:300m,qwen3-embedding:0.6b
```

Los modelos del benchmark deben estar instalados. Mide latencia real, no calidad; no hay un modelo universalmente «mejor» para todos los equipos y proyectos. Cambiar de modelo o de sus pesos requiere volver a indexar; los espacios vectoriales se mantienen separados.

El setup también recomienda un modelo de chat para tu agente. No lo descarga por defecto; si lo quieres, usa `modai client setup --download --with-chat`. **La inferencia de chat sigue a cargo de tu agente y de su runtime local.** Si no quieres modelos, `modai search` continúa funcionando con búsqueda de texto.

Consulta [la guía de modelos y embeddings del cliente](docs/guides/CLIENT-MODELS.md) para compatibilidad, límites, memoria, configuración y fuentes.

## Publicar tus propias skills o paquetes

```sh
modai package scaffold ./mi-skill --name @skills/mi-skill --type skill
# Edita modai.package.yaml y los archivos de contenido generados.
modai package validate ./mi-skill
modai publish ./mi-skill
```

Cada paquete tiene un manifiesto `modai.package.yaml` que declara nombre, versión, tipo, dependencias, archivos a instalar y documentos a indexar. Puedes tomar como referencia [la skill de patrones de diseño](examples/packages/skill-design-patterns/modai.package.yaml).

Una versión publicada es inmutable: para cambiar su contenido incrementa su versión. Publicar y escribir conocimiento o memoria requiere un token `publisher` o `admin`; un token `reader` permite consultar e instalar paquetes.

## Operación diaria

Desde la raíz del repositorio:

| Acción | Comando |
|---|---|
| Ver estado | `docker compose -f deploy/compose.yaml ps` |
| Seguir logs | `docker compose -f deploy/compose.yaml logs -f server` |
| Reconstruir tras cambios | `docker compose -f deploy/compose.yaml up -d --build` |
| Aplicar cambios de configuración | `docker compose -f deploy/compose.yaml up -d --force-recreate` |
| Detener conservando datos | `docker compose -f deploy/compose.yaml down` |
| Exportar backup con la CLI conectada | `modai admin export ./modai-backup.json` |

Los datos de Docker viven en los volúmenes `modularai_modai-data` y `modularai_modai-artifacts`. **No uses `down -v` si quieres conservarlos.** Los backups exportados excluyen API keys y secretos; conserva también copias de los volúmenes para recuperación completa.

Si tienes Node instalado, los atajos `npm run docker:up`, `docker:down`, `docker:logs`, `docker:ps` y `docker:seed` ejecutan los mismos flujos mediante [scripts/deploy.mjs](scripts/deploy.mjs).

### Acceso desde la red local

Configura en `deploy/.env` un token y un hostname que los clientes puedan resolver. Para HTTPS con la CA interna de Caddy:

```sh
docker compose -f deploy/compose.yaml -f deploy/compose.lan.yaml up -d --build
```

Accede a `https://HOST:8443`, sustituyendo `HOST` por `MODAI_HOSTNAME`. Los clientes necesitan resolver ese nombre y confiar en la CA interna de Caddy. El puerto HTTP de MODAI puede seguir limitado a loopback; Caddy lo alcanza por la red interna de Docker. Para HTTP directo en una LAN de confianza, configura `MODAI_BIND_IP=0.0.0.0` y recrea el servidor.

### Si algo no funciona

| Síntoma | Qué revisar |
|---|---|
| El panel no abre | Docker en ejecución, `ps`, logs y puerto configurado en `deploy/.env`. |
| «Token inválido o ausente» | Usa el token del servidor o una API key activa en **Conexión**; comprueba el token de la CLI. |
| «Se requiere rol…» | Utiliza una API key con permiso suficiente para esa operación. |
| El catálogo está vacío o un perfil no existe | Carga los ejemplos o publica tus propios paquetes. El catálogo comienza vacío. |
| La CLI muestra error de versión de Node | Usa Node 26.13.0; `.nvmrc` y `.node-version` fijan esa versión. |
| Cambiaste el token y no se aplica | Recrea el servidor; `restart` no actualiza las variables del contenedor. |

## Estructura del repositorio

```text
MODAI/
├── deploy/                 # Dockerfile, Compose, Caddy y ejemplo de entorno
├── docs/
│   ├── architecture/       # Decisiones y límites del sistema
│   └── guides/             # API, MCP, administración y harness engineering
├── examples/packages/      # Catálogo opcional de paquetes publicables
├── scripts/                # Automatización de despliegue y carga de ejemplos
├── src/
│   ├── client/             # Detección de hardware y embeddings locales
│   ├── cli/                # Comando modai, instalación y autoría
│   ├── core/               # Registro, resolución, contexto y persistencia
│   ├── http/               # API y panel web
│   ├── mcp.ts              # Servidor MCP stdio para clientes
│   └── server.ts           # Entrada del servidor HTTP
├── tests/                  # Pruebas de integración y comportamiento
├── var/                    # Datos de desarrollo local, fuera de Git
│   ├── data/
│   └── artifacts/
├── dist/                   # Salida de compilación, generada
└── node_modules/           # Dependencias instaladas, generadas
```

`package.json`, el lockfile y la configuración de TypeScript y Node permanecen en la raíz porque son puntos de entrada de sus herramientas. `dist/` y `node_modules/` no se editan a mano. En Docker se usan volúmenes; `var/` solo corresponde a la ejecución local fuera del contenedor.

## Desarrollo y documentación

Con Node 26.13.0:

```sh
npm ci
npm run build
npm test
npm run dev
```

El servidor de desarrollo guarda datos en `var/data/` y `var/artifacts/`. Si Docker ya ocupa el puerto 8787, detenlo o asigna otro `MODAI_PORT` al proceso local. Puedes configurar `MODAI_API_TOKEN`, `MODAI_DATABASE_PATH` y `MODAI_ARTIFACT_DIR` como variables de entorno; `npm run dev` no carga `deploy/.env` automáticamente.

Consulta el [índice de documentación](docs/README.md), la [API](docs/guides/API.md), la [administración](docs/guides/MANAGEMENT.md), [modelos del cliente](docs/guides/CLIENT-MODELS.md), [MCP](docs/guides/MCP.md), [harness engineering](docs/guides/HARNESS-ENGINEERING.md) y el [historial de cambios](CHANGELOG.md).

## Alcance actual

MODAI tiene roles por API key, pero aún no ofrece cuentas, OIDC, organizaciones ni replicación entre servidores. El panel permite administrar el registro y su contexto; la ejecución de agentes pertenece a las herramientas cliente. La confianza en publicadores firmados la concede un administrador.

La búsqueda semántica es opcional: el cliente calcula los embeddings y los envía a la API; MODAI solo los almacena y compara. Las rutas y variables de inferencia con Ollama se retiraron en 0.3.0.
