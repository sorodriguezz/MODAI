# MODAI Package Specification v1

`apiVersion: modai.dev/v1` · Esquemas ejecutables: [`packages/contracts/src/spec-v1.ts`](../../packages/contracts/src/spec-v1.ts) · Decisión: [ADR-004](../architecture/ADR-004-package-platform.md)

Esta especificación define qué es un paquete, cómo declara lo que ofrece y lo que necesita, cómo se instala, actualiza y retira, y qué archivos describen un proyecto. El Core la interpreta de forma genérica: **nunca cambia su comportamiento según la categoría de un paquete**.

## 1. Manifiesto: `modai.package.yaml`

```yaml
apiVersion: modai.dev/v1
kind: Package                 # Package | Profile | Adapter
metadata:
  name: "@testing/regression" # @scope/nombre
  version: 1.0.0              # SemVer exacta; una versión publicada es inmutable
  description: Qué aporta y cuándo usarlo.
  license: MIT                # opcional; también authors, homepage, keywords
spec:
  category: testing           # informativa (búsqueda, panel); el Core no la interpreta
  dependencies:               # paquetes concretos (SemVer)
    "@skills/design-patterns": ^1.0.0
  provides:                   # contratos que implementa
    - testing.regression.plan@1.0.0
  requires:                   # contratos que necesita, de cualquier proveedor
    - capability: browser.automation
      version: ^1.0.0
  optional:                   # se usan si existen; su ausencia se informa
    - capability: ai.code-review
  conflicts:                  # incompatibilidades explícitas
    - package: "@x/otro"
    - capability: otro.runner
  permissions: [process.execute, filesystem.read, filesystem.write]
  contributes: { ... }        # ver §3
  entrypoints:                # atajo de autoría; la CLI lo expande a contributes al publicar
    skills: ./skills          # cada subcarpeta con SKILL.md es una skill
    knowledge: ./knowledge    # cada .md/.txt es un documento de conocimiento
    rules: ./rules            # cada .md es una regla
  include: [tools]            # archivos extra del artefacto (scripts de herramientas)
  compatibility:
    modai: ">=0.8.1"          # versión del Core
    os: [linux, darwin, win32]
```

### Tipos (`kind`)

| kind | Uso |
|---|---|
| `Package` | Conocimiento, procedimientos, reglas, herramientas o combinaciones de ellos. |
| `Profile` | Compone otros paquetes mediante `dependencies`. No puede aportar herramientas propias. |
| `Adapter` | Describe con datos cómo materializar contribuciones para un agente (§5). Requiere `spec.adapter`. |

Naturaleza de un paquete según lo que contribuye (no según su categoría):

| Naturaleza | Ejemplo | Uso |
|---|---|---|
| Declarativo | reglas de TypeScript | `rules` / `files` |
| Conocimiento | arquitectura hexagonal | `knowledge`, recuperado bajo demanda |
| Procedimiento | skill de code review | `skills`, activada cuando corresponde |
| Ejecutable | regresión con Playwright | `tools` / `mcpServers`, con permisos |
| Composición | perfil fullstack | `kind: Profile` |
| Adaptador | Cursor, OpenCode | `kind: Adapter` |

## 2. Capacidades

Un identificador de capacidad es un nombre con puntos en minúsculas: `browser.automation`, `testing.regression.execute`, `iot.device.flash`. La versión de `provides` es la **versión de la interfaz** (SemVer); `requires` usa rangos.

Forma abreviada: `"browser.automation@1.2.0"` en `provides` y `"browser.automation@^1.0.0"` en `requires`. Forma completa: `{ capability, version, description }`. Se recomienda describir en `description` del proveedor la interfaz (herramienta, entrada y salida) que garantiza el contrato.

Reglas del resolvedor:

1. Se resuelve el grafo de paquetes (backtracking SemVer, `overrides`, preferencia por versiones del lock, versiones `yanked` excluidas).
2. Se verifica compatibilidad (`os`, `modai`).
3. Cada `requires` debe satisfacerse con un `provides` del conjunto resuelto cuya versión cumpla el rango. Si no, error `CAPABILITY_UNSATISFIED` con los paquetes de los registries que la proporcionan.
4. Con varios proveedores se usa el fijado en `modai.yaml` (`providers`) o, si no hay, el primero por nombre, con un aviso.
5. `optional` sin proveedor se informa; `conflicts` aborta la resolución.

El resolvedor **no instala proveedores implícitamente**: la decisión de qué implementación usar pertenece al proyecto.

## 3. Contribuciones (`spec.contributes`)

| Campo | Contenido | Materialización |
|---|---|---|
| `skills[]` | `{ name, path, files? }`; `path` es una carpeta con `SKILL.md` ([Agent Skills](https://agentskills.io)) | Adaptadores con destino `skills`; recurso MCP `modai://skills/<name>` |
| `rules[]` | `{ name, path, description? }`; fragmento breve de instrucciones | Bloque administrado o un archivo por regla, según el adaptador |
| `knowledge[]` | `{ path, title, tags[] }` | Índice local del Context Gateway; nunca se carga entero en un prompt |
| `tools[]` | `{ name, description, inputSchema, command, args, envKeys, timeoutMs, readOnly, implements? }` | Herramienta del gateway MCP y `modai capability run`, solo si está autorizada |
| `mcpServers[]` | `{ name, description, command, args, envKeys }` | Proceso MCP proxied por el gateway, solo si está autorizado |
| `agents[]` | definición de agente (instrucciones, skills, capacidades, memoria) | Composición por el servidor (ADR-003) |
| `components[]` | `{ name, path, target, description?, language?, tags[] }`; código reutilizable (módulos de backend, componentes de UI, servicios…). Requiere `project.source` | Cada archivo de `path` se copia bajo `target` (marcadores `{component}`, `{package}`). Archivos administrados: `modai remove` retira solo los intactos y conserva los editados |
| `files[]` | `{ source, target, executable? }` | Copia literal a destinos seguros (`.agents/`, `.modai/…`, `docs/` con `project.files`, archivos de instrucciones con `project.instructions`) |

### Contrato de herramientas

- `command: node` usa el runtime de Node que ejecuta MODAI; `./x` o `${packageDir}/x` deben quedar dentro del paquete; otro valor se busca en `PATH`.
- En `args` se sustituyen `${packageDir}` y `${projectDir}`.
- Entrada: JSON por **stdin**, validado contra `inputSchema`. Salida: JSON (o texto) por **stdout**. Código distinto de 0 es error.
- Se ejecuta **sin shell**, con el proyecto como `cwd`, límite de tiempo (`timeoutMs`, máx. 10 min) y de salida (1 MB).
- Entorno mínimo (`PATH`, `HOME`, idioma…) más `MODAI_PROJECT_DIR`, `MODAI_PACKAGE_DIR`, `MODAI_TOOL`; las variables de `envKeys` solo con `env.read` concedido.

### Features (`spec.features`)

Partes opcionales de un paquete que quien lo instala elige con flags: `modai add @components/health-module --nestjs --metrics`. Sirven para armar un paquete por piezas (un framework u otro, métricas sí o no, un conector extra) sin publicar variantes.

```yaml
spec:
  permissions: [project.source]
  contributes:
    components:
      - { name: health, path: component, target: "src/modules/{component}" }
  features:
    nestjs:
      description: Controlador y módulo de NestJS     # lo que se ve en --help
      conflicts: [express]                            # no se combina con express
      overlays:                                       # añade o reemplaza archivos del componente health
        - { component: health, path: features/nestjs }
    express:
      description: Router de Express
      conflicts: [nestjs]
      overlays: [{ component: health, path: features/express }]
    metrics:
      description: Métricas Prometheus
      default: true                                   # activa salvo --no-metrics
      contributes:                                    # mismas claves que spec.contributes (sin agents)
        knowledge: [{ path: features/metrics/METRICS.md, title: Métricas }]
    tls:
      description: TLS en el endpoint
      requires: [metrics]                             # se activa junto con metrics
      dependencies: { "@acme/certs": ^1.0.0 }         # paquetes extra mientras esté activa
```

| Campo | Significado |
|---|---|
| `description` | Obligatoria. Es lo que muestran `modai add <paquete> --help`, `modai feature list` y el panel. |
| `default` | `true`: activa salvo que se quite (`--no-<feature>`). Por defecto `false`. |
| `requires` / `conflicts` | Features que se activan con esta / que no se pueden combinar con esta. |
| `dependencies` | Paquetes que se instalan solo con la feature activa. Entran en la resolución como las del paquete. |
| `contributes` | Skills, reglas, conocimiento, herramientas, servidores MCP, componentes o archivos que se suman a los del paquete. |
| `overlays[]` | `{ component, path }`: los archivos de `path` se añaden al componente `component` (del paquete o de una feature requerida) y reemplazan los que tengan la misma ruta relativa. Varias features se aplican en el orden del manifiesto. |

Reglas, comprobadas al publicar:

- Nombres en minúsculas con guiones (`x-lib`), que no empiecen por `no-` ni coincidan con opciones de la CLI (`allow`, `force`, `help`, `with`, `sync`, `root`, `filter`…).
- Cada feature se puede activar: lo que trae por `requires` no puede chocar entre sí.
- Las carpetas de una feature son solo suyas: ni el base ni otra feature pueden tener archivos dentro, y ninguna usa la raíz del paquete (`.`).
- Los archivos de un overlay cumplen las mismas reglas de destino que los del componente (nada en carpetas ocultas, `node_modules`, etc.).
- Un `Profile` no puede aportar herramientas ni servidores MCP, tampoco a través de features.
- `requires` sin ciclos, sin referencias a features inexistentes y con defaults compatibles entre sí.
- Una feature aporta algo (`contributes`, `dependencies`, `overlays` o `requires`) y sus contribuciones se validan como las del paquete, permisos incluidos (una herramienta en una feature exige `process.execute` en `spec.permissions`).
- Los nombres de contribuciones son únicos en el paquete y en todas sus features.
- Los archivos de una feature viven **fuera** de las carpetas del paquete base (por ejemplo `features/<nombre>/`); si no, el base los instalaría siempre.
- El artefacto publicado incluye los archivos de todas las features; cada proyecto instala solo los de las que eligió.

Al instalar, el Core trabaja con el **paquete efectivo** (base + features activas): adaptadores, índice de capacidades, contexto y herramientas lo ven como un paquete normal.

- **Autorización**: `modai permissions grant` autoriza las herramientas y servidores MCP de las features activas en ese momento. Activar o quitar una feature deja el paquete sin autorizar hasta repetir el grant (la salida de `sync` lo avisa), así una feature nunca habilita código que nadie revisó.
- **Versiones**: si la versión más nueva de un rango no admite las features elegidas, se usa la más nueva que sí y `sync`/`update` lo avisan.
- **Dependencias compartidas**: si dos features activas dependen del mismo paquete, se exigen ambos rangos.
- **Servidor**: al componer agentes se usan las features por defecto de cada paquete (lo mismo que `modai add` sin flags).

## 4. Permisos

| Permiso | Qué autoriza |
|---|---|
| `project.instructions` | Escribir fuera de `.modai/` y `.agents/` (archivos de instrucciones de agentes: `AGENTS.md`, `CLAUDE.md`, `.cursor/…`). Se concede al instalar (`--allow`). |
| `project.files` | Instalar archivos literales bajo `docs/`. Se concede al instalar. |
| `project.source` | Instalar `components` en el árbol de código (`src/`, `lib/`, `app/`…). Nunca en carpetas ocultas, en archivos de la raíz (`package.json`, `Makefile`…) ni en rutas reservadas. Se concede al instalar. |
| `process.execute` | Ejecutar `tools`. Obligatorio para declarar herramientas. |
| `mcp.connect` | Iniciar `mcpServers`. |
| `filesystem.read`, `filesystem.write`, `network` | Intención declarada de la herramienta; se muestra al autorizar. |
| `env.read` | Reenviar las variables declaradas en `envKeys`. |

Las contribuciones ejecutables se habilitan con `modai permissions grant <paquete>`, que muestra comandos y permisos y concede **todos** los declarados, por equipo, ligados a la `integrity` exacta. MODAI no es un sandbox: un proceso autorizado corre con los permisos del usuario.

## 5. Adaptadores

```yaml
kind: Adapter
spec:
  permissions: [project.instructions]
  adapter:
    id: cursor
    description: Reglas .mdc y gateway MCP.
    targets:
      skills: { path: ".cursor/skills/{skill}" }                     # opcional
      rules:  { mode: file, path: ".cursor/rules/{package}-{rule}.mdc", header: "---\ndescription: {description}\n---" }
      index:  { mode: block, file: AGENTS.md }                       # resumen de skills, herramientas y conocimiento
      mcp:    { file: .cursor/mcp.json, pointer: mcpServers.modai, value: { command: modai-mcp, args: [--project, .] } }
```

- `rules` admite `mode: block` (un bloque administrado `<!-- modai:begin rules -->…<!-- modai:end rules -->` en un archivo) o `mode: file` (un archivo por regla).
- Marcadores: `{skill}`, `{package}` (`@scope/name` → `scope-name`), `{rule}`; los valores se sanean y no pueden introducir segmentos de ruta.
- Un adaptador solo escribe dentro de carpetas ocultas de configuración (`.cursor/`, `.claude/`…) o en documentos/configuración de la raíz (`.md`, `.mdc`, `.json`, `.yaml`, `.toml`, `.txt`); nunca en árboles de código ni en ubicaciones que ejecutan código automáticamente (`.husky/`, `.devcontainer/`, `package.json`, `Makefile`, CI…).
- Rutas reservadas siempre bloqueadas: `.git`, `.github`, `.vscode`, `.idea`, `node_modules`, `.ssh`, `modai.yaml`, `modai.lock`, `.modai/store`, memoria y grants.

Integrados (mismo esquema, definidos como datos en el Core): `agent-skills` (`.agents/skills`), `agents-md` (`AGENTS.md`), `claude-code` (`.claude/skills`, `CLAUDE.md`, `.mcp.json`), `mcp` (`.modai/mcp.json`).

## 6. Proyecto: `modai.yaml`

```yaml
apiVersion: modai.dev/v1
kind: Project
name: shop
registries:                     # en orden; un paquete se sirve entero desde el primero que lo conoce
  - { name: team, path: ../modai-registry }
  - { name: central, url: https://modai.example.com }
dependencies:
  "@profiles/fullstack-quality": ^1.0.0
  "@acme/mi-paquete": file:../mi-paquete
  "@components/health-module": ^1.1.0
features:                       # elección por paquete: true activa, false quita una que viene por defecto
  "@components/health-module": { nestjs: true, metrics: true }
overrides: {}                   # fija versiones, también transitivas
providers:                      # proveedor elegido por capacidad
  browser.automation: "@testing/playwright"
adapters: [agent-skills, claude-code, mcp]
signaturePolicy: optional       # optional | signed | trusted
context:
  memory: local                 # local | remote | off
  # server: https://modai.example.com
  # projectId: <id>             # memoria remota compartida por el equipo
```

## 7. Lock: `modai.lock`

Determinista (sin marcas de tiempo, claves ordenadas). Por paquete: `version`, `source`, `integrity` (`sha256-…` sobre el manifiesto publicado y el hash de cada archivo), `signer`, `kind`, `category`, dependencias resueltas, `provides`, proveedor elegido para cada `requires`, `permissions` y `features` (las aplicadas, ya resueltas con defaults y `requires`). Además, `capabilities` (proveedor por contrato) y `managed`: cada archivo, bloque o entrada JSON escrito, con su hash y dueño.

## 8. Ciclo de vida

| Operación | Comportamiento |
|---|---|
| `modai add` | Resuelve, verifica integridad/firma, extrae al store, materializa con los adaptadores, actualiza lock e índice. Un fallo no deja instalaciones parciales de archivos del proyecto. |
| `modai add <paquete> --x --no-y` | Igual, con las features elegidas: cada flag se aplica al paquete escrito antes y se guarda en `features` de `modai.yaml`. `modai add <paquete> --help` lista las que declara. |
| `modai feature list\|enable\|disable\|reset` | Cambia las features de un paquete instalado y sincroniza: se instalan o retiran sus archivos y dependencias (los archivos editados por el usuario se conservan). |
| `modai sync [--frozen]` | Reconstruye exactamente lo descrito por el lock; `--frozen` falla si el lock no corresponde. |
| `modai update [paquetes]` | Ignora el lock para esos paquetes dentro de los rangos de `modai.yaml`. |
| `modai remove` | Retira solo lo que sigue intacto; conserva y reporta cambios del usuario. |
| Conflicto | Archivo, bloque o entrada JSON editados a mano detienen la instalación (`MANAGED_CONFLICT`) salvo `--force`. |
| Integridad | La misma versión con contenido distinto en el registry se rechaza (`LOCK_INTEGRITY_MISMATCH`); un store alterado deshabilita las herramientas del paquete. |

## 9. Validación del manifiesto

Un manifiesto debe declarar `apiVersion: modai.dev/v1`; sin él se rechaza al cargar el paquete (`loadPackageSource`), al publicarlo y al leerlo de un registry (`INVALID_MANIFEST`).

### Agentes

`contributes.agents[].capabilities` lista nombres de herramientas. Cada nombre es una herramienta integrada de MODAI (`modai_search_knowledge`, `modai_recall`, `modai_remember`; esta última exige `memory.write: true`) o el `name` de un servidor de `contributes.mcpServers` de un paquete que el agente resuelve (el propio o una dependencia). Las herramientas de `contributes.tools` no se seleccionan desde el agente: las expone el gateway tras `modai permissions grant`.
