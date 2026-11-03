# ModularAI MCP

El ejecutable `modai-mcp` es el servidor MCP del proyecto (transporte stdio). Lee `modai.yaml` y `modai.lock` del directorio indicado con `--project` (por defecto, el actual) y expone:

- `modai_search_knowledge`: busca fragmentos del conocimiento instalado.
- `modai_read_knowledge`: devuelve un fragmento completo por su id.
- `modai_recall` y `modai_remember`: leen y guardan memoria del proyecto (cuando la memoria está habilitada).
- `modai_list_capabilities`: capacidades, skills y herramientas instaladas.
- `modai_project_status`: identidad del proyecto y versiones fijadas.

Además publica las skills como recursos y las herramientas y servidores MCP de los paquetes instalados que hayas autorizado con `modai permissions grant`.

Ejemplo de configuración genérica:

```json
{
  "mcpServers": {
    "modai": {
      "command": "modai-mcp",
      "args": ["--project", "."]
    }
  }
}
```

La conexión al servidor central y su token salen de la configuración de `modai login`; no guardes tokens en archivos versionados.
