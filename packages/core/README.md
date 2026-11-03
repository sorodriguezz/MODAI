# @modai/core

Núcleo de MODAI ([ADR-004](../../docs/architecture/ADR-004-package-platform.md)). Biblioteca sin dependencia de servidor que conoce **contratos**, no frameworks, metodologías ni agentes. Workspace privado: se incorpora al CLI `@sorodriguez/modai` y al servidor.

| Módulo | Responsabilidad |
|---|---|
| `normalize.ts`, `validate.ts`, `source.ts` | Especificación v1, validación estructural y empaquetado |
| `resolver.ts` | Dependencias (backtracking SemVer) y capacidades (`provides`/`requires`/`optional`/`conflicts`), compatibilidad |
| `registry.ts` | `LocalRegistry` (carpeta), `HttpRegistry` (servidor MODAI), `CompositeRegistry` |
| `adapters.ts`, `targets.ts` | Adaptadores declarativos (integrados como datos) y destinos seguros |
| `installer.ts` | Store verificable, archivos/bloques/JSON administrados, conflictos y retiro reversible |
| `workspace.ts`, `project.ts` | `modai.yaml`, `modai.lock`, grants locales y la operación `syncWorkspace` |
| `context.ts`, `memory.ts` | Context Gateway (BM25 con procedencia) y memoria local por ámbito |
| `tools.ts` | Autorización y ejecución de herramientas de paquetes (sin shell, con límites) |

Regla de diseño: si agregar una capacidad nueva exige editar este paquete, la capacidad está mal modelada. Debe expresarse como paquete, contrato o adaptador.
