# Agentes y capacidades en MODAI

MODAI mantiene un catálogo central de paquetes, resuelve composiciones inmutables y autoriza el acceso al contexto. El CLI y el puente MCP son clientes independientes. La API HTTP no ejecuta modelos ni comandos suministrados por paquetes.

## Instalación del cliente

El monorepo separa `apps/server`, `apps/admin` y los workspaces internos `@modai/contracts` y `@modai/sdk`. El único paquete público es `@sorodriguez/modai`; su build incorpora los contratos y el SDK. Fastify y SQLite no son dependencias del cliente.

```sh
npm ci
npm run pack:client
```

Se genera un único archivo en `dist/npm/`. Puedes distribuirlo e instalarlo sin clonar el repositorio en el equipo cliente:

```sh
npm install -g ./sorodriguez-modai-VERSION.tgz
modai --help
modai-mcp --help
```

El CLI está preparado para publicarse en npm, pero generar el archivo no lo publica. Cuando lo publiques con el nombre `@sorodriguez/modai`, bastará `npm install -g @sorodriguez/modai`. Servidor, CLI, MCP, SDK, contratos y workers usan Node 26.13.0, la última versión estable de la rama 26 verificada para esta entrega. Todos los paquetes declaran `>=26.13.0 <27`; `.nvmrc`, `.node-version` y Docker fijan 26.13.0.

Consulta el [flujo completo del servidor central](CENTRAL-SERVER.md) y la [publicación del CLI](PUBLISH-CLI.md).

## Conectar y autorizar un proyecto

Conecta usando una clave `publisher` o `admin` para crear el proyecto. Una clave `reader` puede inicializar un proyecto ya autorizado con `--project ID`.

```sh
# connect solicita la API key con entrada oculta; MODAI_API_TOKEN permite automatizarlo.
modai server connect https://modai.equipo.cl
cd mi-proyecto
modai init --name mi-proyecto
modai status
```

El identificador lo registra el servidor. Un repositorio existente conserva `modai.yaml` (con `context.projectId`) para que otros clientes usen la misma memoria. No vuelvas a generar su ID en cada equipo.

Cada API key pertenece a un usuario y nunca supera sus permisos: rol igual o menor y, si se acota, solo proyectos, organizaciones y namespaces de ese usuario. Cada persona crea las suyas en el panel (**Mis API keys**); una administración puede crearlas a nombre de quien gestiona:

```sh
modai admin create-key --label lector --owner ana --role reader --projects ID_PROYECTO
modai admin create-key --label autor --owner ana --role publisher --projects ID_PROYECTO --scopes @skills,@agents,@tools
modai admin create-key --label ejecutor --owner ci-bot --role worker --projects ID_PROYECTO
```

Un publisher puede crear sus propios proyectos; no puede acceder a los de otras personas sin una asignación. El rol worker permite consultar su contexto, escribir memoria y reclamar/finalizar tareas de sus proyectos, pero no publicar paquetes ni administrar el servidor. Las claves admin tienen acceso completo.

## Publicar, componer y activar un agente

Publica los ejemplos mediante `npm run seed:examples` con servidor y token configurados. Incluyen `@agents/backend-reviewer`. Los agentes trabajan sobre un proyecto vinculado al servidor (`modai init --project ID`), cuyo registry es ese servidor: la activación instala los paquetes del agente en `modai.yaml` y `modai.lock` con las versiones exactas que compuso el servidor.

```sh
modai agent list
modai agent compose @agents/backend-reviewer
modai agent activate @agents/backend-reviewer --adapter agents-md --allow project.instructions
```

La activación:

1. Resuelve el agente y sus dependencias SemVer en el servidor.
2. Verifica artefactos y firmas según la política del cliente y del servidor.
3. Fija las versiones del bundle en los overrides del proyecto.
4. Instala las skills y genera `.modai/agent.md`, `.modai/activation.json` y `.modai/mcp.json`.
5. Con `agents-md` o `claude-md`, añade un bloque administrado a `AGENTS.md` o `CLAUDE.md` conservando el contenido exterior.

Si un paquete de harness ya administra el archivo raíz, usa `--adapter files` y carga el contexto del agente mediante MCP; el adaptador evita modificar archivos que pertenecen a otro paquete.

`modai agent deactivate` retira la activación y conserva los archivos generados que hayas modificado. Las skills instaladas se gestionan por separado con los comandos de paquetes.

El adaptador `files`, predeterminado, genera los archivos MODAI sin editar instrucciones raíz. El entorno anfitrión debe leer `.modai/agent.md` o seguir la referencia generada. La activación no controla automáticamente un editor que no interprete esos archivos.

Los permisos para instalar instrucciones o ejecutar procesos se autorizan también en un archivo privado de este equipo, fuera del repositorio. Los flags de un manifiesto o de `activation.json` no pueden autorizarse por sí mismos. Una copia del proyecto en otro directorio o equipo necesita su propia aprobación para lanzar procesos.

Una reactivación permite seleccionar otra versión y actualiza los pins que administraba la activación anterior. Si cambiaste `.modai/agent.md`, se detiene para conservar tus modificaciones.

## Contrato del paquete

Un agente es una contribución (`contributes.agents`) de un paquete v1:

```yaml
apiVersion: modai.dev/v1
kind: Package
metadata:
  name: "@agents/backend-reviewer"
  version: 1.0.0
  description: Revisión backend con patrones de diseño y contexto del proyecto.
spec:
  category: agent
  dependencies:
    "@skills/design-patterns": ^1.0.0
  contributes:
    agents:
      - name: backend-reviewer
        instructions: Revisa el alcance solicitado y sustenta los hallazgos con evidencia.
        skills: ["@skills/design-patterns"]
        capabilities: [modai_search_knowledge, modai_recall]
        memory:
          read: [project]
          write: false
        runtime:
          provider: ollama
```

Las skills deben declararse como dependencias y resolver a un paquete que contribuya skills. `capabilities` es una lista de nombres de herramientas; cada nombre es una herramienta integrada de MODAI o un servidor MCP aportado por un paquete que el agente resuelve. Un nombre que no corresponde a ninguno es un error al publicar (cuando el paquete no tiene dependencias) o al componer. Los perfiles siguen siendo agrupaciones de dependencias; no ejecutan agentes por sí solos.

### Herramientas integradas

MODAI trae las herramientas de conocimiento y memoria (definidas en `@modai/contracts/agent-tools`); ningún paquete tiene que aportarlas:

| Herramienta | Comportamiento |
|---|---|
| `modai_search_knowledge` | Busca entre los paquetes fijados del bundle |
| `modai_recall` | Recupera memoria según los ámbitos declarados por el agente |
| `modai_remember` | Guarda memoria de proyecto; exige `memory.write: true` (si no, publicar o componer falla con `MEMORY_POLICY`) y permiso de la API key |

Los esquemas validan los argumentos antes de invocar la herramienta. Publicar un paquete no inicia ningún proceso.

### Servidores MCP

Un servidor MCP se declara en `contributes.mcpServers` de cualquier paquete y requiere `permissions: [mcp.connect]`. El agente lo selecciona por su `name`:

```yaml
spec:
  permissions: [mcp.connect]
  contributes:
    mcpServers:
      - name: docs
        description: Consulta la documentación interna
        command: node
        args: ["${packageDir}/server.mjs"]
        envKeys: []
```

El bundle (`AgentBundle.capabilities`) resuelve cada nombre a `kind: "builtin"` o `kind: "mcp"` (este incluye el `package` que lo aporta). El servidor lo calcula al componer y el cliente lo recalcula al verificar el bundle con la misma función (`resolveAgentCapabilities`, en `@modai/core`); si no coinciden, el bundle se rechaza.

Su activación exige `--allow mcp.connect --allow-mcp NOMBRE`, y `--allow-env VARIABLE` para cada variable de `envKeys`. Estas aprobaciones se guardan en un archivo privado de este equipo. El puente (o `modai agent run`) arranca el proceso stdio autorizado, descubre sus herramientas y las publica con un prefijo estable para evitar colisiones. `${packageDir}` apunta al store del paquete y solo se resuelve si su contenido coincide con `modai.lock`; si no, ejecuta `modai sync`. Reinicia el puente después de cambiar la activación.

Las herramientas ejecutables de un paquete (`contributes.tools`) no se seleccionan desde el agente: las expone el gateway `modai-mcp` cuando las autorizas con `modai permissions grant`.

Los procesos autorizados se ejecutan con los permisos del usuario o del worker. Estos límites no constituyen un sandbox del sistema operativo. Para ejecutar herramientas que necesiten aislamiento, aloja el worker en un entorno restringido controlado por el operador.

## Usar el agente desde un entorno MCP

Importa la configuración de `.modai/mcp.json` en tu cliente. El proceso `modai-mcp --project /ruta/al/proyecto` lee su activación y expone sus herramientas seleccionadas. Sin agente activo conserva las herramientas generales de registro, conocimiento y memoria; la API sigue aplicando los permisos de la clave.

El recurso `modai://agent/active` y el prompt `modai_agent` permiten a clientes compatibles cargar directamente las instrucciones y skills por MCP. El prompt recibe el argumento `task`; el entorno anfitrión debe seleccionarlo o cargar el recurso.

Las credenciales globales se guardan con permisos restrictivos, fuera del repositorio. Una credencial guardada para un servidor no se reenvía a otro servidor elegido por un manifiesto de proyecto. `MODAI_API_TOKEN` es una credencial proporcionada explícitamente por el entorno del proceso.

## Ejecutar localmente

Ollama y el modelo deben estar instalados en ese equipo. MODAI comprueba que el modelo corresponde a pesos locales, sin descargarlo automáticamente.

```sh
modai agent run 'Revisa las decisiones de arquitectura' --model MODELO_LOCAL
```

El ejecutor construye el contexto del bundle y realiza un ciclo limitado de llamadas al modelo y a sus herramientas. No tiene acceso automático a los archivos del repositorio: añade herramientas explícitas si tu tarea necesita leer o modificar código. El máximo predeterminado es 12 pasos; `--max-steps` admite hasta 32. Cada ejecución tiene presupuesto de contexto y tiempo.

## Ejecutar mediante workers

```sh
# En el proyecto que solicita el trabajo:
modai agent submit 'Revisa las decisiones de arquitectura'
modai agent runs list
modai agent runs show ID_EJECUCION
modai agent runs cancel ID_EJECUCION

# En otro equipo, con API key worker y Ollama local:
modai server connect https://modai.equipo.cl
modai agent worker --project ID_PROYECTO --model MODELO_LOCAL
```

El worker exige publicadores localmente autorizados por defecto. Registra sus claves públicas con `modai permissions trust public.pem` antes de ejecutar. Para un catálogo de desarrollo explícitamente sin firmas, usa `--signature-policy optional`; el worker nunca reduce una política más estricta del servidor o de su configuración global.

Cada tarea conserva el bundle y las versiones del momento de envío. El worker reclama una tarea con un lease de 60 segundos y lo renueva durante la ejecución. Un worker caído permite reclamar la tarea al vencer el lease, con un máximo de tres intentos. Un lease viejo no puede finalizar una tarea reclamada por otro worker. La cancelación invalida el lease y el worker aborta al detectarlo en su siguiente renovación.

La cola ofrece ejecución al menos una vez: una caída después de un efecto externo y antes de guardar el resultado puede repetir ese efecto. Los servidores MCP que escriban en sistemas externos deben admitir idempotencia. `--idempotency-key` evita duplicar el envío de una misma tarea, no vuelve idempotentes sus herramientas.

## Memoria compartida

`project` es el ámbito predeterminado. `session` requiere `sessionId` y solo aparece al consultar esa sesión. `organization` comparte información entre proyectos de una misma organización únicamente cuando la clave tiene acceso explícito a esa organización y la consulta lo solicita. El ámbito no puede cambiarse al editar una memoria; crea otra de forma deliberada.

Guardar memoria es una llamada explícita del agente o del usuario. No modifica los pesos del modelo ni captura automáticamente conversaciones. La búsqueda de memoria es textual; la búsqueda vectorial sigue correspondiendo al conocimiento.

## Confianza y límites

- `modai permissions signatures optional|signed|trusted` configura el mínimo del cliente.
- `modai permissions trust public.pem` autoriza un publicador localmente por fingerprint.
- `MODAI_SIGNATURE_POLICY` configura el mínimo del servidor.
- `modai admin trust-publisher public.pem --label equipo` registra la confianza del servidor, incluso antes de publicar el primer paquete.
- Una firma válida acredita integridad y autoría, no inocuidad de las instrucciones o herramientas.
- Los destinos sensibles como `.git`, `.github`, `.env`, `package.json` y el estado interno de MODAI se rechazan. Las instrucciones raíz y `docs/` requieren permisos declarados y concedidos. Los enlaces simbólicos dentro de rutas administradas se rechazan.
- Los embeddings nuevos se almacenan en BLOB normalizado. La API calcula el ranking en workers acotados, con límites de candidatos y concurrencia; no es un índice ANN para millones de documentos. Si se supera el límite, devuelve un error que pide reducir paquetes o usar un índice especializado.
