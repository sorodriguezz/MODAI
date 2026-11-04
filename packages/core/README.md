# @modai/core

Núcleo de MODAI: una biblioteca sin dependencia de servidor que conoce **contratos**, no frameworks, metodologías ni agentes. La CLI la incorpora en su build y el servidor la usa para validar, resolver y componer. Es un workspace privado; no se publica en npm.

Regla de diseño: si agregar una capacidad nueva exige editar este paquete, la capacidad está mal modelada. Debe expresarse como paquete, contrato de capacidad o adaptador. El formato que interpreta está en [`@modai/contracts`](../contracts/README.md).

## Responsabilidades

| Responsabilidad    | Qué hace                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paquetes           | Carga una carpeta (`loadPackageSource`), expande `entrypoints`, normaliza y valida el manifiesto v1, calcula `integrity` y empaqueta en ZIP.          |
| Resolución         | Backtracking SemVer con `overrides` y preferencia por el lock; contratos `provides`/`requires`/`optional`/`conflicts`; compatibilidad de SO y Core.   |
| Registries         | `LocalRegistry` (carpeta), `HttpRegistry` (servidor MODAI) y `CompositeRegistry`: un paquete se sirve entero desde el primer registry que lo conoce.  |
| Instalación        | Store verificable en `.modai/store/<paquete>/` (`modai-store.json`), archivos, bloques y entradas JSON administrados, conflictos y retiro reversible. |
| Adaptadores        | Destinos declarativos; los integrados (`agent-skills`, `agents-md`, `claude-code`, `mcp`) son datos con el mismo esquema que un `kind: Adapter`.      |
| Workspaces         | `modai.yaml`, `modai.lock`, grants locales y la operación `syncWorkspace`, que reconstruye un proyecto completo de forma atómica.                     |
| Contexto y memoria | Índice BM25 local con procedencia y lectura por fragmentos; memoria local por ámbito.                                                                 |
| Herramientas       | Autorización ligada a la `integrity` y ejecución sin shell, con límites de tiempo, salida y entorno.                                                  |
| Agentes            | `resolveAgentCapabilities`: el servidor la usa al componer y la CLI al verificar el bundle, con el mismo resultado.                                   |
| Templates          | Manifiesto `modai.template.yaml`, validación de features y add-ons, y composición por capas de un proyecto nuevo.                                     |

## Cómo se instala un paquete

1. `resolveWorkspace` lee `modai.yaml` y el lock, consulta los registries y resuelve paquetes, features y capacidades.
2. Cada paquete se descarga, se verifica su `integrity` (y su firma según `signaturePolicy`) y se extrae al store.
3. `planContributions` calcula el estado deseado del paquete efectivo (base + features) para cada adaptador activo; `targets` rechaza destinos inseguros y los que exigen un permiso no concedido.
4. `applyDesiredState` compara con lo administrado en el lock: escribe lo nuevo, retira lo que ya no corresponde si sigue intacto y se detiene con `MANAGED_CONFLICT` ante cambios del usuario (salvo `--force` o `--keep-mine`, que deja `<archivo>.modai-new`).
5. Se escriben el lock y el índice de contexto. Un fallo no deja archivos del proyecto a medias.

## Templates

`composeTemplate` crea un proyecto aplicando capas en orden: la base del template, cada feature activa (su add-on `uses` y luego su carpeta) y por último los add-ons `--with`. Un archivo de una capa posterior reemplaza al anterior. Los marcadores `{{clave}}` se sustituyen en rutas y archivos de texto; `{{projectName}}` es el nombre de la carpeta destino. Las features de un template pueden añadir paquetes al `modai.yaml` del proyecto nuevo.

## Código

| Carpeta             | Contenido                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `src/packages/`     | Carga, normalización, validación, features, integridad, ZIP y conversión de `.skill`           |
| `src/resolution/`   | Resolvedor de dependencias y capacidades, rangos y versiones                                   |
| `src/registries/`   | Registries de carpeta, HTTP y compuestos                                                       |
| `src/installation/` | Store, adaptadores, destinos seguros, plan de contribuciones, aplicación y retiro              |
| `src/projects/`     | `modai.yaml`, `modai.lock`, grants, `syncWorkspace` y sugerencias de proveedores               |
| `src/agents/`       | Contexto BM25, memoria local, autorización y ejecución de herramientas, capacidades de agentes |
| `src/templates/`    | Manifiesto, validación, archivo y composición de templates                                     |

Las pruebas viven en `test/` y se ejecutan con `npm test` desde la raíz.
