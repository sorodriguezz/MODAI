# ADR-004 — MODAI como plataforma de paquetes y capacidades extensibles para IA

## Estado

Aceptado e implementado en 0.6.0. Reemplaza el modelo de tipos cerrados de ADR-001 y convierte a ADR-003 (agentes compuestos por el servidor) en un modo opcional.

## Contexto

Hasta 0.5 MODAI funcionaba, pero cada capacidad nueva exigía tocar el Core:

- `type` era un enum cerrado de 11 valores; la calidad, el scaffold y la composición de agentes hacían `switch` por tipo. Un paquete de *testing*, *frontend* o *IoT* no tenía lugar sin modificar código.
- Los destinos de instalación estaban codificados para agentes concretos (`.opencode/agents/`, `AGENTS.md`, `CLAUDE.md`). Soportar otro agente obligaba a cambiar el Core.
- No existían contratos de capacidades: un paquete solo podía depender de otro paquete por nombre, nunca de "algo que automatice un navegador".
- El resolvedor vivía únicamente en el servidor: sin la instancia central (la Raspberry) no se podía instalar nada.
- El lock guardaba el `artifactId` del servidor, no un hash de contenido: no era reproducible entre registries.
- Un paquete no podía traer su propia herramienta ejecutable; dependía de un archivo de bindings del operador.

## Decisión

**MODAI no crece agregando funcionalidades a su Core. Crece con paquetes que el Core descubre, instala, configura y conecta.**

El Core (`packages/core`, `@modai/core`) es una biblioteca sin dependencia de servidor con cinco responsabilidades permanentes:

| Responsabilidad | Implementación |
|---|---|
| Package Manager | `syncWorkspace`, store verificable `.modai/store`, `installer.ts` (archivos, bloques y entradas JSON administrados) |
| Dependency Resolver | `resolver.ts`: backtracking SemVer, overrides, preferencia por el lock, compatibilidad de SO y de versión del Core |
| Capability Registry | `provides`/`requires`/`optional`/`conflicts` versionados; selección y fijación de proveedores (`providers` en `modai.yaml`) |
| Context Gateway | `context.ts` (BM25 local con procedencia y lectura por fragmentos) y `memory.ts` (memoria local por ámbito o remota) |
| Adapter System | `adapters.ts`: adaptadores **declarativos**; los integrados son datos con el mismo esquema que un paquete `kind: Adapter` |

Todo lo demás es instalable. El Core no conoce React, NestJS, SDD, Playwright, OpenCode ni Cursor: solo contratos.

Las decisiones concretas:

1. **Especificación de paquetes v1** (`apiVersion: modai.dev/v1`, [especificación](../spec/PACKAGE-SPEC-v1.md)). `category` es informativa; el comportamiento depende de `contributes` (skills, rules, knowledge, tools, mcpServers, agents, files) y de los contratos de capacidades.
2. **Contratos de capacidades.** `@testing/regression` requiere `browser.automation@^1`; `@testing/playwright` la proporciona. Mañana otro paquete puede proporcionarla sin cambiar ni el Core ni `@testing/regression`. Las herramientas declaran `implements` para que el agente las descubra por contrato.
3. **Registries intercambiables.** `LocalRegistry` (carpeta), `HttpRegistry` (servidor MODAI, compatible con 0.5) y dependencias `file:`. Un paquete se sirve completo desde el primer registry que lo conoce (sin mezclar versiones: evita *dependency confusion*). La Raspberry pasa a ser un registry privado opcional, no un requisito.
4. **`modai.yaml` + `modai.lock`** en la raíz del proyecto. El lock es determinista (sin marcas de tiempo) y guarda `integrity` (`sha256` del manifiesto publicado y de cada archivo), fuente, firmante, capacidades resueltas y cada archivo/bloque/entrada JSON administrado con su hash.
5. **Adaptadores declarativos.** `agent-skills`, `agents-md`, `claude-code` y `mcp` vienen integrados como datos; `@adapters/cursor` y `@adapters/opencode` son paquetes de ejemplo. Un adaptador solo describe destinos con plantillas (`{skill}`, `{package}`, `{rule}`): nunca ejecuta código.
6. **Gateway MCP único** (`modai-mcp`). Expone conocimiento por fragmentos, memoria, skills como recursos y las herramientas autorizadas de los paquetes. Es la frontera donde se aplican los permisos.
7. **Instalar no es autorizar.** Las herramientas y servidores MCP de un paquete se habilitan solo con `modai grant`, por equipo, ligado a la `integrity` exacta. Si el contenido cambia, la autorización caduca. Las autorizaciones nunca viajan con el repositorio.
8. **Compatibilidad.** Los manifiestos `schemaVersion: 1` se normalizan a v1 al leerse (las skills legacy se convierten en contribuciones de skill). Los proyectos 0.5 siguen funcionando y se convierten con `modai migrate`. La composición de agentes por el servidor (ADR-003) continúa disponible para proyectos `--legacy`.

## Reglas que no se rompen

1. **Independencia**: ningún paquete obliga a instalar un modelo, framework o agente salvo que lo declare como dependencia o requisito.
2. **Reproducibilidad**: `modai.yaml` + `modai.lock` reconstruyen exactamente el entorno (`modai sync --frozen` en CI). Contenido distinto para la misma versión se rechaza.
3. **Reversibilidad**: al retirar un paquete se eliminan sus archivos, bloques y entradas JSON solo si siguen intactos; las modificaciones del usuario se conservan y se informan.
4. **Seguridad**: cada contribución ejecutable declara permisos; instalarla no los concede. MODAI aplica lo que controla (escrituras, procesos, variables de entorno) y lo documenta: **no es un sandbox**.
5. **Portabilidad**: cambiar de agente es cambiar `adapters` en `modai.yaml`; el conocimiento, las skills y las herramientas no se reinstalan.

Sobre proveedores de modelos: una suscripción de chat (ChatGPT Plus, Claude Pro) no equivale a acceso API. Los adaptadores de proveedor deberán usar los mecanismos de autenticación que cada proveedor admite.

## Criterio de aceptación

> Un desarrollador externo debe poder crear un paquete de pruebas de regresión, publicarlo, instalarlo en un proyecto, conectarlo a un agente compatible y ejecutarlo sin modificar una sola línea del código fuente de MODAI Core.

Está automatizado en [`tests/acceptance.test.ts`](../../tests/acceptance.test.ts): scaffold → publish a un registry de carpeta → `init` sin servidor → `add` falla sugiriendo el proveedor de `browser.automation` → instalación → `grant` → ejecución vía MCP → búsqueda de conocimiento y memoria → clon reproducible con `--frozen` → retiro reversible. [`tests/core.test.ts`](../../tests/core.test.ts) prueba además un adaptador nuevo como paquete de datos y la instalación del perfil `@profiles/fullstack-quality`.

## Consecuencias

- Frontend, ciberseguridad, regresión, bases de datos, DevOps o IoT se incorporan como paquetes y contratos, no como cambios del Core.
- El servidor central conserva catálogo, memoria compartida, panel, agentes y workers, y usa el mismo resolvedor y validador del Core.
- Coste aceptado: dos formatos de proyecto convivieron durante la transición. Desde 0.8.0 solo se opera `modai.yaml`; `modai migrate` convierte los proyectos 0.5 y los agentes del servidor se instalan como dependencias v1.

## Plan de migración

| Fase | Estado |
|---|---|
| 01 Especificación v1 de paquetes, proyecto y lock | Hecho (`packages/contracts/src/spec-v1.ts`, `docs/spec/PACKAGE-SPEC-v1.md`) |
| 02 Core separado del servidor | Hecho (`packages/core`; el servidor lo consume) |
| 03 Adaptadores independientes (Agent Skills, AGENTS.md, Claude Code, MCP; Cursor y OpenCode como paquetes) | Hecho |
| 04 Conocimiento y memoria como capacidades (búsqueda local con procedencia, memoria por ámbito) | Hecho; búsqueda híbrida con embeddings locales en el Core: pendiente |
| 05 Paquetes de referencia (arquitectura, frontend, regresión ejecutable) | Hecho (`examples/packages`) |
| 06 Agentes v1 compuestos localmente (sin servidor) a partir de `contributes.agents` | Pendiente |
