# @sorodriguez/modai

Cliente independiente de MODAI. Un único paquete instala `modai`, `modai-mcp`, activación de agentes, ejecución con Ollama local y worker opcional. El SDK y los contratos están incorporados; no necesitas clonar el servidor ni instalar otros paquetes MODAI. Requiere Node `>=26.13.0 <27`.

```sh
npm install -g @sorodriguez/modai
modai connect https://modai.equipo.cl
# Introduce tu API key con entrada oculta.
cd mi-proyecto
modai init --project ID_ASIGNADO_POR_EL_ADMIN
modai agent activate @agents/backend-reviewer --adapter agents-md --allow project.instructions
```

Si el proyecto ya contiene `.modai/manifest.yaml`, usa `modai sync` en lugar de `init`. `modai whoami` muestra la identidad y los proyectos autorizados. Para automatizaciones usa `MODAI_API_TOKEN` o `modai connect URL --token-stdin`.

Configura el cliente MCP de tu editor para ejecutar `modai-mcp --project /ruta/absoluta/proyecto`. Usa `modai agent run "TAREA" --model MODELO_LOCAL` para ejecutar con un modelo instalado en tu Ollama. El servidor central conserva catálogo, memoria y cola; las claves asignan permisos por proyecto y namespace.

Los procesos y herramientas externos requieren autorización local. Consulta `modai --help` y `modai-mcp --help`.
