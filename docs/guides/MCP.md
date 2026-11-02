# Servidor MCP

`modai-mcp` es un servidor MCP real por stdio. Usa la conexión de `modai connect`, `MODAI_SERVER` y `MODAI_API_TOKEN`.

```json
{
  "mcpServers": {
    "modularai": {
      "command": "modai-mcp",
      "env": {
        "MODAI_SERVER": "http://127.0.0.1:8787",
        "MODAI_API_TOKEN": "token-reader-o-publisher"
      }
    }
  }
}
```

Herramientas:

| Tool | Mutación | Propósito |
|---|---:|---|
| `modai_search_knowledge` | No | Recupera conocimiento de paquetes instalados |
| `modai_semantic_search` | No | Calcula el embedding en el cliente y busca en el registro; requiere setup e indexación previos |
| `modai_recall` | No | Busca memoria del proyecto |
| `modai_remember` | Sí | Guarda decisión/restricción/aprendizaje |
| `modai_list_packages` | No | Consulta el registro |
| `modai_project_status` | No | Lista manifest, overrides y lock |

Ejecuta el proceso con el directorio de trabajo del proyecto para que detecte `.modai/manifest.yaml`. Usa token `reader` si no necesita `remember`; este último requiere `publisher`.

Para búsqueda semántica ejecuta primero `modai client setup --download` y `modai embed index` en ese equipo cliente. El servidor MCP utiliza su configuración local de modelos, no la del host Docker. Consulta [modelos del cliente](CLIENT-MODELS.md).

## Agente activo y capacidades dinámicas

En 0.5 se añaden `modai_list_agents` y `modai_list_capabilities`. Usa `modai-mcp --project /ruta/proyecto` para seleccionar explícitamente el proyecto. Sin activación se conservan las herramientas generales de la tabla anterior.

Si existe `.modai/activation.json`, las herramientas de conocimiento y memoria generales se sustituyen por las seleccionadas en el bundle del agente. Una definición sin permiso de escritura no expone una herramienta genérica que permita saltarse esa política. Los procesos MCP stdio declarados por sus paquetes se conectan únicamente si fueron autorizados durante la activación; sus herramientas se descubren y se publican con un prefijo estable.

Los bindings locales requieren `--bindings archivo.yaml`. Las variables adicionales requieren autorización explícita. Reinicia el puente después de activar o cambiar el agente. Consulta [agentes y capacidades](AGENTS-AND-CAPABILITIES.md).

El agente activo también expone el recurso Markdown `modai://agent/active` y el prompt `modai_agent` con argumento `task`. Los clientes que admiten recursos o prompts pueden cargar las instrucciones y skills directamente por MCP, además de usar los adaptadores de archivos.

## Proyectos v1 (`modai.yaml`)

En proyectos v1, `modai-mcp --project <ruta>` funciona **sin servidor**: lee `modai.lock`, el store verificado y el índice local. Los adaptadores escriben la configuración por ti (`.mcp.json` con `claude-code`, `.modai/mcp.json` con `mcp`, `.cursor/mcp.json` con `@adapters/cursor`, `opencode.json` con `@adapters/opencode`).

| Herramienta / recurso | Descripción |
|---|---|
| `modai_search_knowledge` | Fragmentos relevantes con paquete, versión y ruta; filtros `packages` y `limit` |
| `modai_read_knowledge` | Texto completo de un fragmento por id |
| `modai_list_capabilities` | Contratos instalados, proveedor elegido, skills y estado de autorización de herramientas |
| `modai_project_status` | Dependencias y versiones fijadas |
| `modai_recall`, `modai_remember` | Memoria local o remota según `context.memory` |
| herramientas de paquetes | Solo las autorizadas con `modai grant` y cuya copia local coincide con `modai.lock` |
| `<servidor>__<herramienta>` | Herramientas de `mcpServers` de paquetes autorizados, proxied por el gateway |
| `modai://skills/<nombre>[/<archivo>]` | Skills instaladas como recursos |

Los resultados de herramientas son datos: nunca amplían permisos.
