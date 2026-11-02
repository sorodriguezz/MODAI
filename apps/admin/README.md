# Panel web MODAI

Aplicación privada del monorepo. `src/index.html` define las secciones; `styles.css` y `theme.js` controlan la apariencia; `views/` separa paquetes, agentes, proyectos, memoria, accesos y conexión. `lib/` contiene API, iconos y funciones compartidas.

`npm run build -w @modai/admin` genera los assets en `dist/`. El servidor los sirve bajo `/admin` en el mismo origen que la API. Docker copia únicamente esos assets al runtime, sin dependencias del build web.

Ejecuta `npm run dev:admin` junto a `npm run dev` para reconstruir los cambios al guardar y recarga el navegador. Todo usa Node `>=26.13.0 <27`.
