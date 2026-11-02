# Panel web MODAI

Aplicación privada del monorepo, en JavaScript sin dependencias de runtime. El servidor la sirve en `/admin`, en el mismo origen que la API; la sesión usa una cookie `HttpOnly` (ver [docs/guides/ADMIN-PANEL.md](../../docs/guides/ADMIN-PANEL.md)).

- `src/index.html`: estructura base (pantalla de acceso, barra lateral, barra superior, diálogo y notificaciones).
- `src/main.js`: arranque, inicio de sesión/instalación, navegación por hash (`#/paquetes…`) y menú del usuario.
- `src/views/`: una sección por archivo (`dashboard`, `packages`, `agents`, `knowledge`, `projects`, `memories`, `runs`, `connect`, `users`, `access`, `audit`) más `auth` y `account`.
- `src/lib/`: `api.js` (fetch con cabecera CSRF), `html.js` (plantillas que escapan todo por defecto), `ui.js` (diálogos, confirmaciones, toasts, formularios, esqueletos) e `icons.js`.
- `src/state.js`: identidad actual, caché de datos, permisos por rol y normalización de manifiestos legados y `modai.dev/v1`.
- `styles.css` y `theme.js`: tokens de color, tema claro/oscuro/sistema y diseño responsive.

La CSP es estricta (`script-src 'self'`): no uses scripts ni manejadores en línea; enlaza eventos con `addEventListener` o `delegate()` y construye HTML solo con la plantilla `html\`\``.

`npm run build -w @modai/admin` genera los assets minificados en `dist/`. Ejecuta `npm run dev:admin` junto a `npm run dev` para reconstruir al guardar y recarga el navegador. Todo usa Node `>=26.13.0 <27`.
