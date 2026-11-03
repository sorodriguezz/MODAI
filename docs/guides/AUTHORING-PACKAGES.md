# Crear, publicar e instalar paquetes MODAI

Esta guía recorre el caso que define a MODAI ([ADR-004](../architecture/ADR-004-package-platform.md)): un desarrollador externo crea un paquete de pruebas de regresión, lo publica, lo instala en un proyecto, lo conecta a un agente y lo ejecuta **sin modificar el Core**. La referencia completa está en la [especificación v1](../spec/PACKAGE-SPEC-v1.md).

No necesitas servidor: un registry puede ser una carpeta (local, compartida o un repositorio git).

## 1. Crear el paquete

```sh
modai package scaffold ./regression --name @acme/regression --category testing --with-tool
```

Genera:

```text
regression/
├── modai.package.yaml
├── skills/regression/SKILL.md     # procedimiento que el agente activa cuando corresponde
├── knowledge/README.md            # conocimiento recuperado bajo demanda
├── rules/README.md                # regla breve para las instrucciones del agente
└── tools/run.mjs                  # herramienta ejecutable (stdin JSON → stdout JSON)
```

Declara contratos en lugar de depender de herramientas concretas:

```yaml
spec:
  provides: [testing.regression.report@1.0.0]
  requires:
    - capability: browser.automation   # cualquier paquete que la proporcione
      version: ^1.0.0
  permissions: [process.execute, filesystem.read]
  contributes:
    tools:
      - name: regression_compare
        implements: testing.regression.report
        description: Compara resultados contra la línea base.
        command: node
        args: ["${packageDir}/tools/run.mjs"]
        inputSchema: { type: object, properties: { results: { type: object } }, required: [results], additionalProperties: false }
  include: [tools]
```

Valida estructura, contratos y calidad:

```sh
modai package validate ./regression
```

## 2. Publicar

```sh
modai package publish ./regression --registry ~/modai-registry          # carpeta
modai package publish ./regression --registry https://modai.tu-dominio  # servidor MODAI (API key publisher)
modai package keygen && modai package publish ./regression --key .modai/keys/modai-ed25519-private.pem --registry ~/modai-registry   # firmado
```

En el panel, **Paquetes → Crear paquete** guía en pasos (tipo, identidad, archivos, dependencias, revisión con validación automática) y solo deja publicar en tus namespaces.

### Skills empaquetadas (`.skill`)

Un archivo `.skill` es un ZIP con `SKILL.md` (con `name` y `description` en el frontmatter) y sus referencias. MODAI lo convierte en un paquete v1 que contribuye esa skill (`@namespace/nombre-de-la-skill`):

```sh
modai package publish ./code-review.skill --namespace @skills            # versión del frontmatter o 1.0.0
modai package publish ./code-review.skill --namespace @skills --skill-version 1.2.0
```

Sin `--namespace`, se usa el único namespace donde la credencial puede publicar. En el panel: **Paquetes → Crear paquete → Skill → Subir un archivo .skill** (archivo, namespace, vista previa con calidad, publicar). Una carpeta con `SKILL.md` también se publica con `modai skill publish ./mi-skill`, y `modai skill export @ns/skill` la descarga como `.skill`. API: `POST /api/v1/packages/import-skill`.

Una versión publicada es inmutable: para cambiarla incrementa `metadata.version`. Mientras desarrollas puedes instalarla sin publicar con `modai add file:../regression`.

## 3. Instalar en un proyecto

```sh
cd mi-proyecto
modai init --registry ~/modai-registry --adapter agent-skills,claude-code,mcp --allow project.instructions
modai add @acme/regression
# Error: @acme/regression requiere la capacidad browser.automation@^1.0.0 ...
#        Paquetes que la proporcionan: @testing/playwright@1.0.0
modai add @testing/playwright @acme/regression
modai capability list
```

Resultado:

- `modai.yaml` (lo que pides) y `modai.lock` (lo resuelto, con `integrity`): versiona ambos.
- Skills en `.agents/skills/` y `.claude/skills/`, reglas e índice en `CLAUDE.md`, gateway en `.mcp.json` y `.modai/mcp.json`.
- `.modai/store/` y `.modai/context-index.json`: caché reconstruible, ya excluida con `.modai/.gitignore`.

## 4. Autorizar y conectar a un agente

Instalar no autoriza a ejecutar nada:

```sh
modai permissions grant @testing/playwright   # muestra comandos y permisos y pide confirmación
modai permissions grant @acme/regression
modai capability run regression_compare --input '{"results":{"tests":[]}}'
```

Los agentes compatibles con MCP leen el gateway desde `.mcp.json` (Claude Code), `.modai/mcp.json` (cualquier cliente) u otro archivo según el adaptador. El servidor MCP `modai` expone:

| Herramienta / recurso | Uso |
|---|---|
| `modai_search_knowledge`, `modai_read_knowledge` | Conocimiento por fragmentos con paquete, versión y ruta |
| `modai_recall`, `modai_remember` | Memoria del proyecto (local o del servidor) |
| `modai_list_capabilities` | Qué paquete implementa cada contrato y qué herramientas están habilitadas |
| herramientas de paquetes | Solo autorizadas y con integridad verificada |
| `modai://skills/<nombre>` | Skills como recursos |

## 5. Mantener

```sh
modai outdated
modai update @acme/regression
modai sync --frozen        # en CI: falla si el lock no corresponde
modai remove @acme/regression
```

Si el contenido de un paquete autorizado cambia, `modai sync` avisa que requiere `modai permissions grant` de nuevo.

## Soportar otro agente

Un agente nuevo se soporta con un paquete `kind: Adapter` que solo describe destinos. Mira [`examples/packages/adapter-cursor`](../../examples/packages/adapter-cursor/modai.package.yaml) y [`adapter-opencode`](../../examples/packages/adapter-opencode/modai.package.yaml):

```sh
modai add @adapters/cursor --allow project.instructions
modai adapter add cursor
```

## Paquetes de referencia

| Paquete | Muestra |
|---|---|
| `@patterns/frontend-architecture` | Skill + conocimiento + regla; capacidad opcional `browser.automation` |
| `@architecture/decision-records` | Procedimiento con `references/` y plantilla de ADR |
| `@testing/playwright` | Proveedor ejecutable de `browser.automation` |
| `@testing/regression` | Requiere `browser.automation`; herramienta de línea base que escribe dentro del proyecto |
| `@profiles/fullstack-quality` | Perfil que compone los anteriores y una skill |
| `@adapters/cursor`, `@adapters/opencode` | Adaptadores como datos |
