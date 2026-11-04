# Panel web MODAI

Aplicación en JavaScript sin dependencias de runtime que el [servidor](../server/README.md) sirve en `/admin`, en el mismo origen que la API (`/api/v1`). Es un workspace privado; sus assets compilados viajan dentro de la imagen del servidor.

## Guía de uso

### Primer inicio

En un servidor sin usuarios, `/admin` muestra **Crea la cuenta de administración**. Pide el **token de instalación** (el valor de `MODAI_API_TOKEN` o una API key `admin` activa, para que nadie reclame un servidor recién expuesto), un usuario (3 a 64 caracteres: letras, números, `.`, `-`, `_`; se guarda en minúsculas), un nombre visible y una contraseña de al menos 10 caracteres. La pantalla desaparece en cuanto existe un usuario.

En despliegues automatizados, `MODAI_ADMIN_USERNAME` y `MODAI_ADMIN_PASSWORD` siembran la primera cuenta al arrancar; después se ignoran y puedes retirar la contraseña del entorno.

### Sesión

- El error de inicio de sesión es siempre el mismo («Usuario o contraseña incorrectos»), exista o no el usuario.
- Tras 5 intentos fallidos en 15 minutos el usuario queda bloqueado 15 minutos; cada IP tiene además un límite por minuto.
- El menú del usuario (arriba a la derecha) permite **Cambiar contraseña**, que cierra las sesiones en otros dispositivos, y **Cerrar sesión**. Si la sesión expira, vuelves al inicio con un aviso.

### Secciones

| Sección                   | Para qué                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Biblioteca › Resumen**  | Estado del catálogo y del servidor.                                                                                                                                                                                                |
| **Biblioteca › Paquetes** | Catálogo con pestañas por tipo (componentes, harness, skills, herramientas, agentes, conocimiento, perfiles, adaptadores y templates). Detalle con archivos, versiones, calidad, features y proyectos que lo usan.                 |
| **Crear paquete**         | Asistente por pasos: tipo, identidad, archivos (editor, `.zip` o carpeta), dependencias (por namespace, paquete y versión), opciones (features) y revisión con validación. También perfiles, templates y skills desde un `.skill`. |
| **Proyectos**             | Proyectos del servidor, su conocimiento y sus memorias. Un administrador o quien lo creó puede eliminarlo escribiendo su identificador.                                                                                            |
| **Ejecuciones**           | Tareas encoladas para workers, su estado y resultado.                                                                                                                                                                              |
| **Conectar un cliente**   | Pregunta qué quieres hacer (editor, publicar, worker, explorar), crea tu API key con el rol y alcance justos, muestra los comandos y la configuración MCP (Claude Code, Cursor, VS Code) y verifica en vivo la conexión.           |
| **Mis API keys**          | Tus keys: crear y revocar.                                                                                                                                                                                                         |
| **Administración**        | Usuarios, Accesos (API keys de quienes administras), Organizaciones, Namespaces, Categorías y Auditoría (con exportación y depuración).                                                                                            |

Un agente se usa desde el detalle de su paquete (**Usar agente**). El panel oculta las secciones y acciones que tu rol no permite según los `permissions` que calcula el servidor; la autorización real la decide siempre el servidor.

### Usuarios, roles y API keys

Los usuarios usan los mismos roles que las API keys (`reader`, `publisher`, `worker`, `org-admin`, `admin`; detalle en el [README del servidor](../server/README.md#identidades-roles-y-accesos)). Crear o editar un usuario o una key sigue los pasos Cuenta, Rol, Organizaciones, Proyectos, Namespaces y Revisión, y solo ofrece proyectos y namespaces de las organizaciones elegidas.

- Siempre queda al menos un administrador activo, y nadie puede eliminarse, desactivarse ni cambiar su propio rol.
- Los cambios de rol y accesos aplican al instante; desactivar o restablecer la contraseña cierra las sesiones de esa persona.
- Toda API key pertenece a un usuario y nunca supera sus permisos. Las keys solo se crean con sesión del panel: una key no puede crear otras. Para un worker o CI, crea un usuario para ese fin (por ejemplo `ci-bot`) y genera su key. Las keys sin dueño aparecen como _Sin dueño_ y se les puede asignar uno desde Accesos.
- **Auditoría → Depurar auditoría** y **Memorias → Depurar antiguas** muestran cuánto se borrará antes de confirmar.

## Código

```text
src/
  index.html        estructura base: acceso, barra lateral, barra superior, diálogo y notificaciones
  main.js           arranque; enlaza los módulos de app/
  app/              router.js (vistas y navegación por hash), shell.js, session.js, user-menu.js, sidebar.js, state.js y theme.js
  shared/ui/        diálogos, toasts, formularios, contraseñas, pestañas, esqueletos, estados vacíos, bloques de código y editor de archivos
  shared/pickers/   combobox de namespaces y categorías, selector de dependencias y editor de opciones (features)
  shared/lib/       api.js (fetch con cabecera CSRF), html.js (plantillas que escapan por defecto), iconos, archivos, versiones, asistentes, calidad y manifiestos v1
  features/         una carpeta por área: packages, knowledge, memories, projects, runs, connect, keys, account, auth, dashboard y admin
  styles/           base/, layout/, components/ y features/; index.css los importa y el build genera un único styles.css
scripts/build.mjs   build con esbuild hacia dist/
test/               pruebas unitarias del panel
```

Cada vista exporta un objeto con nombre (por ejemplo `packagesView`) que se registra en `app/router.js`. La CSP es estricta (`script-src 'self'`): sin scripts ni manejadores en línea; los eventos se enlazan con `addEventListener` o `delegate()` y el HTML se construye solo con la plantilla `html\`\``.

`npm run build -w @modai/admin` genera los assets minificados en `dist/`. Ejecuta `npm run dev:admin` junto a `npm run dev` para reconstruir al guardar. Las pruebas de interfaz están en [`e2e/`](../../e2e) (`npm run test:ui`).
