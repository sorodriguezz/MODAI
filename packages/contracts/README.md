# @modai/contracts

Tipos, esquemas Zod y reglas compartidas por el Core, la CLI y el servidor: el formato de paquetes `apiVersion: modai.dev/v1`, agentes, capacidades, entradas de la API, firmas, hashes, rutas seguras y calidad de paquetes. No depende del servidor. Es un workspace privado que el build de la CLI incorpora; no se publica en npm.

Este README es la **especificación de paquetes v1**. El Core la interpreta de forma genérica: nunca cambia su comportamiento según la categoría de un paquete.

- [Manifiesto](#manifiesto-modaipackageyaml)
- [Tipos](#tipos-kind)
- [Capacidades](#capacidades)
- [Contribuciones](#contribuciones-speccontributes)
- [Features](#features-specfeatures)
- [Permisos](#permisos)
- [Adaptadores](#adaptadores)
- [Agentes](#agentes)
- [Proyecto](#proyecto-modaiyaml)
- [Lock](#lock-modailock)
- [Ciclo de vida](#ciclo-de-vida)
- [Crear y publicar un paquete](#crear-y-publicar-un-paquete)
- [Código](#código)

## Manifiesto: `modai.package.yaml`

```yaml
apiVersion: modai.dev/v1
kind: Package # Package | Profile | Adapter | Template
metadata:
  name: "@testing/regression" # @scope/nombre
  version: 1.0.0 # SemVer exacta; una versión publicada es inmutable
  description: Qué aporta y cuándo usarlo.
  license: MIT # opcional, igual que authors, homepage y keywords
spec:
  category: testing # informativa (búsqueda, panel); el Core no la interpreta
  dependencies: # paquetes concretos (SemVer)
    "@skills/design-patterns": ^1.0.0
  provides: # contratos que implementa
    - testing.regression.plan@1.0.0
  requires: # contratos que necesita, de cualquier proveedor
    - capability: browser.automation
      version: ^1.0.0
  optional: # se usan si existen; su ausencia se informa
    - capability: ai.code-review
  conflicts: # incompatibilidades explícitas
    - package: "@x/otro"
    - capability: otro.runner
  permissions: [process.execute, filesystem.read, filesystem.write]
  contributes: {} # skills, rules, knowledge, tools, mcpServers, agents, components, files
  features: {} # partes opcionales que se eligen al instalar
  entrypoints: # atajo de autoría; la CLI lo expande a contributes al publicar
    skills: ./skills # cada subcarpeta con SKILL.md es una skill
    knowledge: ./knowledge # cada .md/.txt es un documento
    rules: ./rules # cada .md es una regla
  include: [tools] # archivos extra del artefacto, por ejemplo scripts de herramientas
  compatibility:
    modai: ">=0.8.1"
    os: [linux, darwin, win32]
```

Sin `apiVersion: modai.dev/v1` el manifiesto se rechaza al cargarlo (`loadPackageSource`), al publicarlo y al leerlo de un registry (`INVALID_MANIFEST`).

## Tipos (`kind`)

| kind       | Uso                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Package`  | Conocimiento, procedimientos, reglas, herramientas, código o combinaciones de ellos.                                                                                                                            |
| `Profile`  | Compone otros paquetes mediante `dependencies`. No puede aportar herramientas ni servidores MCP, tampoco desde features.                                                                                        |
| `Adapter`  | Describe con datos cómo materializar contribuciones para un agente. Requiere `spec.adapter`.                                                                                                                    |
| `Template` | Proyecto completo para empezar. No se instala: lo usa `modai template use`, y resolverlo como dependencia falla con `TEMPLATE_NOT_INSTALLABLE`. Sin `contributes`, `dependencies`, `features` ni `permissions`. |

La naturaleza de un paquete depende de lo que contribuye, no de su categoría:

| Naturaleza       | Ejemplo                  | Contribución                          |
| ---------------- | ------------------------ | ------------------------------------- |
| Declarativo      | reglas de TypeScript     | `rules` / `files`                     |
| Conocimiento     | arquitectura hexagonal   | `knowledge`, recuperado bajo demanda  |
| Procedimiento    | skill de code review     | `skills`, activada cuando corresponde |
| Código           | módulo de autenticación  | `components`                          |
| Ejecutable       | regresión con Playwright | `tools` / `mcpServers`, con permisos  |
| Composición      | perfil fullstack         | `kind: Profile`                       |
| Adaptador        | Cursor, OpenCode         | `kind: Adapter`                       |
| Proyecto inicial | NestJS con SDD           | `kind: Template`                      |

## Capacidades

Un identificador de capacidad es un nombre con puntos en minúsculas: `browser.automation`, `testing.regression.execute`, `iot.device.flash`. La versión de `provides` es la versión de la interfaz (SemVer); `requires` y `optional` usan rangos.

Forma abreviada: `"browser.automation@1.2.0"` en `provides` y `"browser.automation@^1.0.0"` en `requires`. Forma completa: `{ capability, version, description }`. El proveedor describe en `description` la interfaz que garantiza (herramienta, entrada y salida). Una herramienta declara `implements` para que el agente la descubra por contrato.

El resolvedor:

1. Resuelve el grafo de paquetes: backtracking SemVer, `overrides`, preferencia por las versiones del lock y versiones `yanked` excluidas.
2. Verifica la compatibilidad (`os`, `modai`).
3. Satisface cada `requires` con un `provides` del conjunto resuelto. Si no hay, falla con `CAPABILITY_UNSATISFIED` y sugiere los paquetes de los registries que la proporcionan.
4. Con varios proveedores usa el fijado en `providers` de `modai.yaml` o, si no hay, el primero por nombre, con un aviso.
5. Informa los `optional` sin proveedor; un `conflicts` aborta la resolución.

El resolvedor **no instala proveedores implícitamente**: qué implementación usar lo decide el proyecto.

## Contribuciones (`spec.contributes`)

| Campo          | Contenido                                                                                                 | Materialización                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills[]`     | `{ name, path, files? }`; `path` es una carpeta con `SKILL.md` ([Agent Skills](https://agentskills.io))   | Adaptadores con destino `skills`; recurso MCP `modai://skills/<name>`                                                                        |
| `rules[]`      | `{ name, path, description? }`; fragmento breve de instrucciones                                          | Bloque administrado o un archivo por regla, según el adaptador                                                                               |
| `knowledge[]`  | `{ path, title, tags[] }`                                                                                 | Índice local del Context Gateway; nunca se carga entero en un prompt                                                                         |
| `tools[]`      | `{ name, description, inputSchema, command, args, envKeys, timeoutMs, readOnly, implements? }`            | Herramienta del gateway MCP y de `modai capability run`, solo si está autorizada                                                             |
| `mcpServers[]` | `{ name, description, command, args, envKeys }`                                                           | Proceso MCP que el gateway expone, solo si está autorizado                                                                                   |
| `agents[]`     | Definición de agente: instrucciones, skills, capacidades, memoria y runtime                               | Composición por el servidor ([Agentes](#agentes))                                                                                            |
| `components[]` | `{ name, path, target, description?, language?, tags[] }`; código reutilizable. Requiere `project.source` | Cada archivo de `path` se copia bajo `target` (marcadores `{component}` y `{package}`); `modai remove` retira solo los intactos              |
| `files[]`      | `{ source, target, executable? }`                                                                         | Copia literal a destinos seguros: `.agents/`, `.modai/…`, `docs/` con `project.files` y archivos de instrucciones con `project.instructions` |

Los nombres de contribuciones son únicos dentro del paquete y de todas sus features.

### Contrato de herramientas

- `command: node` usa el runtime de Node que ejecuta MODAI; `./x` o `${packageDir}/x` deben quedar dentro del paquete; otro valor se busca en `PATH`.
- En `args` se sustituyen `${packageDir}` y `${projectDir}`.
- Entrada: JSON por stdin, validado contra `inputSchema`. Salida: JSON o texto por stdout. Un código distinto de 0 es un error.
- Se ejecuta sin shell, con el proyecto como directorio de trabajo, un límite de tiempo (`timeoutMs`, máximo 10 minutos) y de salida (1 MB).
- Entorno mínimo (`PATH`, `HOME`, idioma) más `MODAI_PROJECT_DIR`, `MODAI_PACKAGE_DIR` y `MODAI_TOOL`; las variables de `envKeys` llegan solo con `env.read` concedido.

## Features (`spec.features`)

Partes opcionales que quien instala elige con flags (`modai add @components/health-module --nestjs --metrics`), para armar un paquete por piezas sin publicar variantes.

```yaml
spec:
  permissions: [project.source]
  contributes:
    components:
      - { name: health, path: component, target: "src/modules/{component}" }
  features:
    nestjs:
      description: Controlador y módulo de NestJS
      conflicts: [express]
      overlays:
        - { component: health, path: features/nestjs }
    express:
      description: Router de Express
      conflicts: [nestjs]
      overlays: [{ component: health, path: features/express }]
    metrics:
      description: Métricas Prometheus
      default: true
      contributes:
        knowledge: [{ path: features/metrics/METRICS.md, title: Métricas }]
    tls:
      description: TLS en el endpoint
      requires: [metrics]
      dependencies: { "@acme/certs": ^1.0.0 }
```

| Campo                    | Significado                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`            | Obligatoria. La muestran `modai add <paquete> --help`, `modai feature list` y el panel.                                                                               |
| `default`                | `true` la activa salvo `--no-<feature>`. Por defecto `false`.                                                                                                         |
| `requires` / `conflicts` | Features que se activan junto con esta / que no se combinan con esta.                                                                                                 |
| `dependencies`           | Paquetes que se instalan solo con la feature activa; entran en la resolución como los del paquete.                                                                    |
| `contributes`            | Mismas claves que `spec.contributes` (sin `agents`), sumadas a las del paquete.                                                                                       |
| `overlays[]`             | `{ component, path }`: los archivos de `path` se añaden al componente y reemplazan los de igual ruta relativa. Varias features se aplican en el orden del manifiesto. |

Reglas comprobadas al publicar:

- Nombres en minúsculas con guiones (`x-lib`) que no empiecen por `no-` ni coincidan con opciones de la CLI (`allow`, `force`, `help`, `with`, `sync`, `root`, `filter`…).
- Cada feature se puede activar: lo que trae por `requires` no choca entre sí; `requires` no tiene ciclos ni referencias inexistentes y los `default` son compatibles.
- Una feature aporta algo (`contributes`, `dependencies`, `overlays` o `requires`) y sus contribuciones se validan como las del paquete, permisos incluidos.
- Sus archivos viven fuera de las carpetas del paquete base (por ejemplo `features/<nombre>/`) y no usan la raíz (`.`); los de un overlay cumplen las reglas de destino del componente.
- El artefacto incluye los archivos de todas las features; cada proyecto instala solo los de las que eligió.

Al instalar, el Core trabaja con el **paquete efectivo** (base + features activas). `modai permissions grant` autoriza las herramientas de las features activas en ese momento: cambiarlas deja el paquete sin autorizar hasta repetir el grant. Si la versión más nueva de un rango no admite las features elegidas, se usa la más nueva que sí, con un aviso. Si dos features dependen del mismo paquete, se exigen ambos rangos. Al componer agentes, el servidor usa las features por defecto.

## Permisos

| Permiso                                          | Qué autoriza                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `project.instructions`                           | Escribir fuera de `.modai/` y `.agents/`: archivos de instrucciones de agentes (`AGENTS.md`, `CLAUDE.md`, `.cursor/…`). Se concede al instalar (`--allow`).        |
| `project.files`                                  | Instalar archivos literales bajo `docs/`. Se concede al instalar.                                                                                                  |
| `project.source`                                 | Instalar `components` en el árbol de código (`src/`, `lib/`, `app/`…), nunca en carpetas ocultas, archivos de la raíz ni rutas reservadas. Se concede al instalar. |
| `process.execute`                                | Ejecutar `tools`. Obligatorio para declarar herramientas.                                                                                                          |
| `mcp.connect`                                    | Iniciar `mcpServers`.                                                                                                                                              |
| `filesystem.read`, `filesystem.write`, `network` | Intención declarada de la herramienta; se muestra al autorizar.                                                                                                    |
| `env.read`                                       | Reenviar las variables declaradas en `envKeys`.                                                                                                                    |

Las contribuciones ejecutables se habilitan con `modai permissions grant <paquete>`, que muestra comandos y permisos y concede todos los declarados, por equipo y ligados a la `integrity` exacta. MODAI no es un sandbox: un proceso autorizado corre con los permisos del usuario.

## Adaptadores

```yaml
kind: Adapter
spec:
  permissions: [project.instructions]
  adapter:
    id: cursor
    description: Reglas .mdc y gateway MCP.
    targets:
      skills: { path: ".cursor/skills/{skill}" }
      rules: { mode: file, path: ".cursor/rules/{package}-{rule}.mdc", header: "---\ndescription: {description}\n---" }
      index: { mode: block, file: AGENTS.md }
      mcp: { file: .cursor/mcp.json, pointer: mcpServers.modai, value: { command: modai-mcp, args: [--project, .] } }
```

- `rules` admite `mode: block` (bloque administrado `<!-- modai:begin rules -->…<!-- modai:end rules -->`) o `mode: file` (un archivo por regla). `index` resume skills, herramientas y conocimiento.
- `mcp` solo registra el gateway de MODAI: el comando de `value` (`command`, `cmd`, `executable`, `program` o `bin`) debe ser `modai-mcp` o una lista que empiece por él; no admite `env` ni las claves `__proto__`, `constructor` o `prototype`.
- Marcadores: `{skill}`, `{package}` (`@scope/name` → `scope-name`) y `{rule}`; se sanean y no pueden introducir segmentos de ruta.
- Un adaptador solo escribe en carpetas ocultas de configuración (`.cursor/`, `.claude/`…) o en documentos y configuración de la raíz (`.md`, `.mdc`, `.json`, `.yaml`, `.toml`, `.txt`); nunca en árboles de código ni donde se ejecuta código automáticamente (`.husky/`, `.devcontainer/`, `package.json`, `Makefile`, CI…).
- Siempre bloqueados: `.git`, `.github`, `.vscode`, `.idea`, `node_modules`, `.ssh`, `modai.yaml`, `modai.lock`, `.modai/store`, la memoria y los grants.

Integrados en el Core, con el mismo esquema: `agent-skills` (`.agents/skills`), `agents-md` (`AGENTS.md`), `claude-code` (`.claude/skills`, `CLAUDE.md`, `.mcp.json`) y `mcp` (`.modai/mcp.json`).

## Agentes

```yaml
spec:
  category: agent
  dependencies:
    "@skills/design-patterns": ^1.0.0
  contributes:
    agents:
      - name: backend-reviewer
        instructions: Revisa el alcance solicitado y sustenta los hallazgos con evidencia.
        skills: ["@skills/design-patterns"]
        capabilities: [modai_search_knowledge, modai_recall]
        memory: { read: [project], write: false }
        runtime: { provider: ollama }
```

- Las skills se declaran también como dependencias y deben resolver a un paquete que contribuya skills.
- `capabilities` nombra herramientas integradas de MODAI (`modai_search_knowledge`, `modai_recall`, `modai_remember`, definidas en `@modai/contracts/agent-tools`) o el `name` de un servidor de `contributes.mcpServers` de un paquete que el agente resuelve. Un nombre desconocido falla al publicar o al componer (`AGENT_CAPABILITY`).
- `modai_remember` exige `memory.write: true` (`MEMORY_POLICY`).
- Las herramientas de `contributes.tools` no se seleccionan desde el agente: las expone el gateway tras `modai permissions grant`.

## Proyecto: `modai.yaml`

```yaml
apiVersion: modai.dev/v1
kind: Project
name: shop
registries: # en orden; un paquete se sirve entero desde el primero que lo conoce
  - { name: team, path: ../modai-registry }
  - { name: central, url: https://modai.example.com }
dependencies:
  "@profiles/fullstack-quality": ^1.0.0
  "@acme/mi-paquete": file:../mi-paquete
  "@components/health-module": ^1.1.0
features: # true activa; false quita una que viene por defecto
  "@components/health-module": { nestjs: true, metrics: true }
overrides: {} # fija versiones, también transitivas
providers: # proveedor elegido por capacidad
  browser.automation: "@testing/playwright"
adapters: [agent-skills, claude-code, mcp]
signaturePolicy: optional # optional | signed | trusted
context:
  memory: local # local | remote | off
```

Con memoria remota, `context.server` y `context.projectId` apuntan al proyecto del servidor cuya memoria comparte el equipo.

## Lock: `modai.lock`

Determinista: sin marcas de tiempo y con claves ordenadas. Por paquete guarda `version`, `source`, `integrity` (`sha256-…` sobre el manifiesto publicado y el hash de cada archivo), `signer`, `kind`, `category`, dependencias resueltas, `provides`, proveedor de cada `requires`, `permissions` y `features` aplicadas. Además, `capabilities` (proveedor por contrato) y `managed`: cada archivo, bloque o entrada JSON escrito, con su hash y su dueño. Versiona `modai.yaml` y `modai.lock`; `.modai/store/` y `.modai/context-index.json` son caché reconstruible.

## Ciclo de vida

| Operación                                    | Comportamiento                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modai add`                                  | Resuelve, verifica integridad y firma, extrae al store, materializa con los adaptadores y actualiza lock e índice. Un fallo no deja instalaciones parciales. |
| `modai add <paquete> --x --no-y`             | Igual, con las features elegidas: cada flag se aplica al paquete escrito antes y se guarda en `features` de `modai.yaml`.                                    |
| `modai feature list\|enable\|disable\|reset` | Cambia las features de un paquete instalado y sincroniza sus archivos y dependencias.                                                                        |
| `modai sync [--frozen]`                      | Reconstruye exactamente lo descrito por el lock; `--frozen` falla si el lock no corresponde.                                                                 |
| `modai update [paquetes]`                    | Ignora el lock para esos paquetes dentro de los rangos de `modai.yaml`.                                                                                      |
| `modai remove`                               | Retira solo lo que sigue intacto; conserva e informa los cambios del usuario.                                                                                |
| Conflicto                                    | Un archivo, bloque o entrada JSON editado a mano detiene la instalación (`MANAGED_CONFLICT`) salvo `--force` o `--keep-mine`.                                |
| Integridad                                   | Contenido distinto para la misma versión se rechaza (`LOCK_INTEGRITY_MISMATCH`); un store alterado deshabilita las herramientas del paquete.                 |

## Crear y publicar un paquete

No hace falta servidor: un registry puede ser una carpeta local, compartida o un repositorio git.

```sh
modai package scaffold ./regression --name @acme/regression --category testing --with-tool
modai package validate ./regression
modai package publish ./regression --registry ~/modai-registry
modai package publish ./regression --registry https://modai.tu-dominio
modai package keygen && modai package publish ./regression --key .modai/keys/modai-ed25519-private.pem
modai add file:../regression
```

`scaffold` genera `modai.package.yaml`, `skills/<nombre>/SKILL.md`, `knowledge/`, `rules/` y, con `--with-tool`, `tools/run.mjs` (stdin JSON → stdout JSON). `validate` revisa estructura, contratos y calidad (0-100). Una versión publicada es inmutable: para cambiarla incrementa `metadata.version`.

Un archivo `.skill` (ZIP con `SKILL.md` y sus referencias) se convierte en un paquete que contribuye esa skill: `modai package publish ./code-review.skill --namespace @skills [--skill-version 1.2.0]`.

Paquetes de referencia en [`examples/packages`](../../examples/packages): `@testing/playwright` (proveedor de `browser.automation`), `@testing/regression` (lo requiere), `@patterns/frontend-architecture`, `@architecture/decision-records`, `@profiles/fullstack-quality`, `@components/health-module` (features) y `@adapters/cursor` / `@adapters/opencode`.

## Código

| Ruta                             | Contenido                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/manifest/`                  | Esquemas v1: paquete, capacidades, contribuciones, features, permisos, adaptadores, proyecto, lock y agentes |
| `src/types.ts`, `src/schemas.ts` | Tipos y esquemas de la API (registros, bundles de agentes, memoria, ejecuciones)                             |
| `src/agent-tools.ts`             | Herramientas integradas que un agente puede seleccionar                                                      |
| `src/security/`                  | Hashes, firmas Ed25519 y rutas seguras                                                                       |
| `src/quality/`                   | Calidad estructural de paquetes y skills                                                                     |
| `src/errors.ts`                  | Errores con código compartidos por CLI y servidor                                                            |

Exportaciones: `@modai/contracts`, `/types`, `/errors`, `/schemas`, `/agent-tools`, `/manifest`, `/security` y `/quality`.
