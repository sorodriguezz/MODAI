# @modai/sdk

Workspace interno privado. El build del CLI incorpora este cliente HTTP; no requiere publicación independiente en npm.

Cliente HTTP de la API v1 de MODAI. Requiere Node 26.13.0 o una versión posterior de la rama 26 y no depende del servidor ni de SQLite.

```js
import { ApiClient } from '@modai/sdk';
const modai = new ApiClient('https://modai.equipo.cl', process.env.MODAI_API_TOKEN);
await modai.assertCompatible();
const projects = await modai.projects();
const bundle = await modai.composeAgent(projects[0].id, '@agents/backend-reviewer');
```

Incluye catálogo, publicación, contexto, proyectos, composición, tareas y protocolo de workers. La autorización se aplica siempre en el servidor.
