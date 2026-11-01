# ModularAI MCP

El ejecutable `modai-mcp` expone cinco herramientas por transporte stdio:

- `modai_search_knowledge`
- `modai_recall`
- `modai_remember`
- `modai_list_packages`
- `modai_project_status`

Ejemplo de configuración genérica:

```json
{
  "mcpServers": {
    "modularai": {
      "command": "modai-mcp",
      "env": {
        "MODAI_SERVER": "http://127.0.0.1:8787"
      }
    }
  }
}
```

Si el servidor exige autenticación, añade `MODAI_API_TOKEN` al entorno seguro del proceso. No guardes el token en archivos versionados.
