# Organización del proyecto

| Directorio | Responsabilidad | Distribución |
|---|---|---|
| `apps/server` | API, autorización, catálogo, memoria, composición, cola y persistencia | Imagen Docker, privado en npm |
| `apps/admin` | Panel web: HTML, CSS, tema y vistas JavaScript | Assets compilados dentro de la imagen del servidor; privado en npm |
| `packages/cli` | Comandos `modai` / `modai-mcp`, activación, runtime local y worker | Único paquete público npm |
| `packages/sdk` | Cliente HTTP usado en desarrollo y compilación | Workspace privado; incorporado al CLI |
| `packages/contracts` | Tipos, esquemas, firmas y validaciones compartidas | Workspace privado; incorporado al CLI y dependencia interna del servidor |
| `deploy` | Dockerfile, Compose, Caddy y plantillas de entorno | Infraestructura de la instancia central |
| `examples/packages` | Paquetes de agentes, skills, perfiles, tools y MCP | Se publican en el catálogo MODAI mediante su API |
| `scripts` | Build auxiliar, empaquetado, prueba del cliente y despliegue | Herramientas del repositorio |
| `tests` | Pruebas de integración y aislamiento | Desarrollo y build Docker |
| `docs` | Guías y decisiones | Documentación |

## Panel web

```text
apps/admin/
├── src/
│   ├── index.html
│   ├── styles.css
│   ├── theme.js
│   ├── main.js                 # Arranque, navegación y refresco
│   ├── state.js
│   ├── lib/                    # API, componentes básicos e iconos
│   └── views/                  # Paquetes, agentes, proyectos, accesos, etc.
├── scripts/build.mjs
└── dist/                       # Assets generados
```

La web se compila de forma independiente. `apps/server/src/http/admin-assets.ts` sirve esos assets bajo `/admin`; el backend no contiene HTML, CSS ni lógica de las vistas. Ambos se despliegan bajo el mismo dominio y usan la API HTTP. No hace falta otro servidor para el frontend.

## Código, configuración y estado

El código fuente vive en `apps` y `packages`. La configuración de la instancia vive en `deploy/.env`, fuera de Git. Las credenciales cliente viven en la configuración del usuario y los IDs/versiones del proyecto en su propia `.modai`.

Docker conserva la base SQLite y los artefactos en volúmenes. Fuera de Docker, el servidor crea `apps/server/var/data` y `apps/server/var/artifacts` al necesitarlos, independientemente del directorio desde el que se arranca. No se versionan carpetas vacías. Puedes cambiar las rutas con `MODAI_DATABASE_PATH` y `MODAI_ARTIFACT_DIR`.

`node_modules` y cada `dist` son generados. La raíz mantiene los workspaces, el lockfile, TypeScript y la versión de Node. Todo el código propio usa Node `>=26.13.0 <27`.

## Desarrollo

```sh
npm ci
npm run build
npm test
# Configura MODAI_API_TOKEN en el entorno antes de arrancar:
npm run dev
```

Para trabajar en el panel, ejecuta también `npm run dev:admin` en otra terminal. Reconstruye los assets al guardar; recarga `/admin` para ver los cambios. El servidor los lee desde `apps/admin/dist`. `npm run build:cli` construye solo el cliente y sus dependencias internas; `npm run pack:client` genera un único `.tgz`.
