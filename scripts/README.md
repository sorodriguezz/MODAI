# Scripts de mantenimiento

Ejecuta los comandos desde la raíz del repositorio.

| Script | Uso |
|---|---|
| `deploy.mjs` | Wrapper multiplataforma de Docker Compose; resuelve siempre los archivos de `deploy/`. |
| `seed-examples.ts` | Publica los paquetes de `examples/packages/` mediante la API. No sobrescribe versiones existentes. |

```sh
npm run docker:up
npm run docker:ps
npm run docker:logs
npm run docker:seed
npm run docker:down
```

Para pasar cualquier otro comando de Compose:

```sh
node scripts/deploy.mjs config --quiet
node scripts/deploy.mjs --lan config --quiet
```

El wrapper no crea credenciales ni cambia el archivo `deploy/.env`. Para publicar ejemplos sin Docker usa `npm run seed:examples` con `MODAI_SERVER` y `MODAI_API_TOKEN` en el entorno.
