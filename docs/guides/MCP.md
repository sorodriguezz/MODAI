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
