# ADR-004 — MODAI como plataforma de paquetes y capacidades extensibles para IA

## Estado

Aceptado. Sustituye el modelo de tipos cerrados de ADR-001 y convierte a ADR-003 (agentes compuestos por el servidor) en un modo opcional.

## Contexto

Una plataforma de paquetes no puede exigir cambios en el Core por cada capacidad nueva. Por eso:

- La categoría de un paquete es informativa: la calidad, el empaquetado y la composición de agentes no hacen `switch` por tipo, así que un paquete de _testing_, _frontend_ o _IoT_ encaja sin modificar código.
- Los destinos de instalación no están codificados para agentes concretos: soportar otro agente es publicar un adaptador.
- Los paquetes dependen de contratos de capacidades ("algo que automatice un navegador"), no solo de otros paquetes por nombre.
- El resolvedor vive en el Core, no en el servidor: sin la instancia central también se puede instalar.
- El lock guarda un hash de contenido, no un identificador del servidor: es reproducible entre registries.
- Un paquete puede traer su propia herramienta ejecutable, sujeta a permisos concedidos por el equipo.

## Decisión

**MODAI no crece agregando funcionalidades a su Core. Crece con paquetes que el Core descubre, instala, configura y conecta.**

El Core (`packages/core`, `@modai/core`) es una biblioteca sin dependencia de servidor con cinco responsabilidades permanentes:

| Responsabilidad     | Implementación                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Package Manager     | `syncWorkspace`, store verificable `.modai/store`, `installer.ts` (archivos, bloques y entradas JSON administrados)         |
| Dependency Resolver | `resolver.ts`: backtracking SemVer, overrides, preferencia por el lock, compatibilidad de SO y de versión del Core          |
| Capability Registry | `provides`/`requires`/`optional`/`conflicts` versionados; selección y fijación de proveedores (`providers` en `modai.yaml`) |
| Context Gateway     | `context.ts` (BM25 local con procedencia y lectura por fragmentos) y `memory.ts` (memoria local por ámbito o remota)        |
| Adapter System      | `adapters.ts`: adaptadores **declarativos**; los integrados son datos con el mismo esquema que un paquete `kind: Adapter`   |

Todo lo demás es instalable. El Core no conoce React, NestJS, SDD, Playwright, OpenCode ni Cursor: solo contratos.

Las decisiones concretas:

1. **Especificación de paquetes v1** (`apiVersion: modai.dev/v1`, [especificación](../spec/PACKAGE-SPEC-v1.md)). `category` es informativa; el comportamiento depende de `contributes` (skills, rules, knowledge, tools, mcpServers, agents, files) y de los contratos de capacidades.
2. **Contratos de capacidades.** `@testing/regression` requiere `browser.automation@^1`; `@testing/playwright` la proporciona. Mañana otro paquete puede proporcionarla sin cambiar ni el Core ni `@testing/regression`. Las herramientas declaran `implements` para que el agente las descubra por contrato.
3. **Registries intercambiables.** `LocalRegistry` (carpeta), `HttpRegistry` (servidor MODAI) y dependencias `file:`. Un paquete se sirve completo desde el primer registry que lo conoce (sin mezclar versiones: evita _dependency confusion_). La Raspberry pasa a ser un registry privado opcional, no un requisito.
4. **`modai.yaml` + `modai.lock`** en la raíz del proyecto. El lock es determinista (sin marcas de tiempo) y guarda `integrity` (`sha256` del manifiesto publicado y de cada archivo), fuente, firmante, capacidades resueltas y cada archivo/bloque/entrada JSON administrado con su hash.
5. **Adaptadores declarativos.** `agent-skills`, `agents-md`, `claude-code` y `mcp` vienen integrados como datos; `@adapters/cursor` y `@adapters/opencode` son paquetes de ejemplo. Un adaptador solo describe destinos con plantillas (`{skill}`, `{package}`, `{rule}`): nunca ejecuta código.
6. **Gateway MCP único** (`modai-mcp`). Expone conocimiento por fragmentos, memoria, skills como recursos y las herramientas autorizadas de los paquetes. Es la frontera donde se aplican los permisos.
7. **Instalar no es autorizar.** Las herramientas y servidores MCP de un paquete se habilitan solo con `modai permissions grant`, por equipo, ligado a la `integrity` exacta. Si el contenido cambia, la autorización caduca. Las autorizaciones nunca viajan con el repositorio.
8. **Agentes como contribuciones.** Los agentes son contribuciones (`contributes.agents`) cuyas `capabilities` nombran herramientas integradas de MODAI (`modai_search_knowledge`, `modai_recall`, `modai_remember`) o servidores MCP de `contributes.mcpServers`; la composición de agentes por el servidor (ADR-003) opera sobre proyectos `modai.yaml`.

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
