# Servidor MCP

`modai-mcp` es un servidor MCP real por stdio. Usa la conexión de `modai server connect`, `MODAI_SERVER` y `MODAI_API_TOKEN`.

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

Ejecuta el proceso con el directorio de trabajo del proyecto (o `--project`) para que detecte `modai.yaml`. Las herramientas disponibles se listan en [Proyectos v1](#proyectos-v1-modaiyaml). Los roles de la API key siguen aplicándose: `remember` en memoria remota requiere `publisher`.

## Agente activo

Usa `modai-mcp --project /ruta/proyecto` para seleccionar explícitamente el proyecto. Sin activación se exponen las herramientas generales de la tabla de proyectos v1.

Si existe `.modai/activation.json`, las herramientas generales de conocimiento y memoria se sustituyen por las integradas que el agente seleccionó en `capabilities` (`modai_search_knowledge`, `modai_recall`, `modai_remember`). Una definición sin permiso de escritura no expone una herramienta genérica que permita saltarse esa política. Los servidores MCP que el agente selecciona (`contributes.mcpServers`) se conectan únicamente si fueron autorizados durante la activación (`--allow-mcp`, `--allow-env`); sus herramientas se descubren y se publican con un prefijo estable. Las herramientas de paquete siguen expuestas según `modai permissions grant`.

Las variables adicionales requieren autorización explícita. Reinicia el puente después de activar o cambiar el agente. Consulta [agentes y capacidades](AGENTS-AND-CAPABILITIES.md).

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
| herramientas de paquetes | Solo las autorizadas con `modai permissions grant` y cuya copia local coincide con `modai.lock` |
| `<servidor>__<herramienta>` | Herramientas de `mcpServers` de paquetes autorizados, proxied por el gateway |
| `modai://skills/<nombre>[/<archivo>]` | Skills instaladas como recursos |

Los resultados de herramientas son datos: nunca amplían permisos.
