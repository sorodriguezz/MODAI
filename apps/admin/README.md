# Panel web MODAI

Aplicación privada del monorepo, en JavaScript sin dependencias de runtime. El servidor la sirve en `/admin`, en el mismo origen que la API; la sesión usa una cookie `HttpOnly` (ver [docs/guides/ADMIN-PANEL.md](../../docs/guides/ADMIN-PANEL.md)).

- `src/index.html`: estructura base (pantalla de acceso, barra lateral, barra superior, diálogo y notificaciones).
- `src/main.js`: solo el arranque; enlaza los módulos de `src/app/`.
- `src/app/`: `router.js` (registro de vistas y navegación por hash), `shell.js` (navegación, cabecera, estado del servidor), `session.js` (inicio de sesión/instalación), `user-menu.js`, `sidebar.js`, `state.js` (identidad, caché y permisos) y `theme.js`.
- `src/shared/ui/`: diálogos, toasts, formularios, contraseñas, pestañas, esqueletos, estados vacíos, bloques de código y editor de archivos.
- `src/shared/pickers/`: combobox de namespaces y categorías, selector de dependencias, editor y selector de opciones (features).
- `src/shared/lib/`: `api.js` (fetch con cabecera CSRF), `html.js` (plantillas que escapan todo por defecto), iconos, archivos, versiones, asistentes paso a paso, calidad y manifiestos `modai.dev/v1`.
- `src/features/`: una carpeta por área (`packages/` con catálogo, detalle, editor, templates, agentes e importación de skills; `knowledge`, `memories`, `projects`, `runs`, `connect`, `keys`, `account`, `auth`, `dashboard` y `admin/` con usuarios, accesos, organizaciones, namespaces, categorías y auditoría). Cada vista exporta un objeto con nombre (por ejemplo `packagesView`) que se registra en `app/router.js`.
- `src/styles/`: CSS dividido en `base/`, `layout/`, `components/` y `features/`; `index.css` los importa en orden y el build los empaqueta en un único `styles.css`.

La CSP es estricta (`script-src 'self'`): no uses scripts ni manejadores en línea; enlaza eventos con `addEventListener` o `delegate()` y construye HTML solo con la plantilla `html\`\``.

`npm run build -w @modai/admin` genera los assets minificados en `dist/`. Ejecuta `npm run dev:admin` junto a `npm run dev` para reconstruir al guardar y recarga el navegador. Todo usa Node `>=26.13.0 <27`.
