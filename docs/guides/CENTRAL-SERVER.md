# Un servidor MODAI para varios usuarios y proyectos

Una instancia conserva el catálogo, las versiones de agentes, la memoria y la cola de tareas. Cada equipo instala únicamente el CLI y se conecta por HTTP(S). El panel está en `/admin` y la API en `/api/v1`, bajo el mismo dominio.

```text
Equipo de Ana ── CLI / MCP ──┐
Equipo de Luis ─ CLI / MCP ──┼── https://modai.tu-dominio.cl
Worker opcional ────────────┘       ├── Panel admin
                                   ├── Catálogo: agentes + skills + tools + MCP
                                   ├── Memoria por proyecto / organización / sesión
                                   └── Cola y resultados de tareas
```

## 1. El administrador levanta una instancia

Copia `deploy/.env.example` a `deploy/.env` y configura un `MODAI_API_TOKEN` aleatorio. Ese token queda reservado al administrador.

Para una red local de confianza, configura la IP real del host:

```dotenv
MODAI_BIND_IP=0.0.0.0
MODAI_PUBLIC_URL=http://192.168.1.20:8787
```

```sh
npm run docker:up
```

Los clientes usan esa dirección, no `localhost` ni el nombre interno `server` de Compose. El host debe aceptar conexiones al puerto publicado. Para TLS interno puedes usar `npm run docker:lan`; los equipos deben confiar en la CA de Caddy. No omitas la validación TLS.

Para acceso por Internet, configura un dominio que controles y cuyo DNS apunte al host:

```dotenv
MODAI_BIND_IP=127.0.0.1
MODAI_PUBLIC_HOST=modai.tu-dominio.cl
```

```sh
npm run docker:public
```

El overlay `compose.public.yaml` publica Caddy en 80/443, solicita el certificado público y anuncia `https://MODAI_PUBLIC_HOST` como dirección del servidor. Los puertos 80/443 deben ser accesibles para completar la emisión y atender a los clientes. Conserva el puerto directo de la API en loopback. Esta configuración no cambia tu DNS ni despliega automáticamente en un proveedor.

`MODAI_PUBLIC_URL` configura la dirección que aparece en `/health` y en los comandos del panel. No modifica DNS, interfaces ni puertos. El overlay público deriva ese valor del dominio. La aplicación usa la raíz del dominio, sin prefijo de ruta.

Los volúmenes Docker conservan SQLite y los artefactos. Mantén una sola instancia de la API para esta base SQLite; varios usuarios y proyectos pueden compartirla. La replicación y la alta disponibilidad requieren otro diseño de almacenamiento.

## 2. El administrador registra el proyecto y sus accesos

1. Abre `https://TU_DOMINIO/admin` e inicia sesión con tu usuario administrador (la primera vez, crea la cuenta con el secreto de arranque `MODAI_API_TOKEN`; ver [guía del panel](ADMIN-PANEL.md)).
2. En **Proyectos**, crea el proyecto compartido.
3. En **Conectar un cliente**, selecciona el proyecto y, opcionalmente, su agente.
4. Pulsa **Dar acceso a un usuario**, indica su nombre o equipo y el uso permitido.
5. Entrega al usuario su token individual y los comandos generados. El token solo se muestra al crearlo.

El formulario asigna exclusivamente ese proyecto y ningún namespace publicable. Los roles disponibles son:

| Uso | Rol | Permisos |
|---|---|---|
| Trabajar con agentes | `publisher` | Consultar el catálogo, guardar memoria y enviar tareas de proyectos autorizados; también puede registrar proyectos propios. |
| Consultar | `reader` | Catálogo y lectura del contexto autorizado. |
| Ejecutar la cola | `worker` | Reclamar tareas y trabajar con el contexto autorizado. |

La publicación de paquetes exige además un namespace, por ejemplo `@skills`. **Accesos y API keys** permite gestionar esos permisos y revocar credenciales. `admin` tiene acceso completo y no se entrega como credencial habitual.

Las identidades actuales son API keys con etiqueta; no existen todavía cuentas de usuario, sesiones web de cuenta, SSO ni OIDC. El catálogo de paquetes se comparte entre clientes autenticados; la memoria está aislada por las asignaciones del proyecto y la organización.

## 3. Cada usuario instala y conecta el cliente

Usa Node 26.13.0 o posterior dentro de la rama 26. Una vez [publicado el CLI](PUBLISH-CLI.md):

```sh
npm install -g @sorodriguez/modai
modai server connect https://modai.tu-dominio.cl
```

`connect` pide el token con entrada oculta y muestra los proyectos autorizados. La configuración queda en `~/.modai/client.yaml`, con permisos restringidos, fuera del repositorio. Para automatizaciones puedes usar `MODAI_API_TOKEN` o `--token-stdin`.

Antes de publicar en npm, distribuye el único archivo generado con `npm run pack:client`:

```sh
npm install -g ./sorodriguez-modai-VERSION.tgz
```

Desde la carpeta del proyecto:

```sh
modai server whoami
modai init --project ID_QUE_ENTREGA_EL_ADMIN
modai status
modai agent list
```

Si el repositorio ya contiene `modai.yaml` y `modai.lock`, usa `modai sync` en lugar de inicializar de nuevo. Conserva ambos archivos en Git para que todos los equipos compartan proyecto y versiones. Antes de empezar, `modai server ping` confirma que el servidor responde y que tu API key es válida. Los permisos para escribir instrucciones o ejecutar herramientas se aprueban localmente en cada equipo. Si un paquete necesita modificar instrucciones, usa `modai sync --allow project.instructions` después de revisar ese permiso.

Con el catálogo de ejemplos cargado, activa un agente reutilizable:

```sh
modai agent activate @agents/backend-reviewer --adapter agents-md --allow project.instructions
modai memory add "Los pedidos usan UUID" --kind decision
modai memory search "pedidos"
```

Otra persona autorizada para el mismo proyecto puede recuperar esa decisión desde su equipo. Otro proyecto mantiene su memoria separada. Las conversaciones del editor no se guardan automáticamente: el agente debe usar las herramientas de memoria o el usuario debe registrar las decisiones.

## 4. El editor consume las capacidades por MCP

Configura tu cliente MCP con el comando instalado y la ruta absoluta del proyecto:

```json
{
  "mcpServers": {
    "modai": {
      "command": "modai-mcp",
      "args": ["--project", "/ruta/absoluta/mi-proyecto"]
    }
  }
}
```

En Windows puedes necesitar la ruta absoluta al ejecutable según el cliente MCP. El proceso hereda la configuración de ese usuario. Reinícialo después de cambiar de agente.

El editor carga las instrucciones desde `AGENTS.md`, otro adaptador compatible, el recurso `modai://agent/active` o el prompt MCP `modai_agent`. El bundle combina versiones concretas de instrucciones, skills y capacidades; el puente expone las herramientas elegidas y autorizadas. Tu editor sigue usando su propio proveedor de modelos.

## 5. Ejecución local o por worker

Para ejecutar desde el CLI, instala un modelo local en Ollama:

```sh
modai agent run "Revisa las decisiones del proyecto" --model MODELO_LOCAL
```

Para delegar, el usuario envía una tarea con `modai agent submit "TAREA"`. Un equipo con credencial `worker`, acceso al proyecto y modelo instalado ejecuta:

```sh
modai agent worker --project ID_PROYECTO --model MODELO_LOCAL
```

El worker exige firmas de publicadores de confianza por defecto; registra y fija sus fingerprints según la [guía de agentes](AGENTS-AND-CAPABILITIES.md). Las tareas permanecen en cola hasta que un worker autorizado las reclame. Su resultado aparece en **Ejecuciones**. La API central conserva las definiciones y el estado; el modelo corre en el cliente o worker.
