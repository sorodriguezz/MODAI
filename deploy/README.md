# Despliegue

Todos los archivos de infraestructura viven aquí:

| Archivo | Responsabilidad |
|---|---|
| `Dockerfile` | Build, pruebas y runtime Node 26.13.0; el contexto es la raíz del repositorio. |
| `Dockerfile.dockerignore` | Exclusiones del contexto para este Dockerfile, incluidos secretos y datos locales. |
| `compose.yaml` | Servidor, volúmenes persistentes y carga opcional de ejemplos. |
| `compose.lan.yaml` | Overlay para HTTPS interno con Caddy. |
| `compose.public.yaml` | Overlay con dominio y certificado público para acceso por Internet. |
| `Caddyfile.public` | Proxy HTTPS con emisión pública de certificados. |
| `Caddyfile` | Proxy inverso, TLS interno y cabeceras HTTP. |
| `.env.example` | Plantilla; copia a `.env` en esta carpeta y cambia el token. |
| `compose.raspberry.yaml` | Overlay para Raspberry Pi: reinicio, límite de memoria, heap de Node, logs rotados e imagen opcional ya construida. |
| `fly/fly.toml` | Fly.io: una máquina, un volumen en `/app/data`, healthcheck y HTTPS. |
| `railway/railway.json`, `railway/variables.example` | Railway: build con este Dockerfile, healthcheck y variables. |
| `backup.sh` | Respaldo en caliente de SQLite y artefactos para instalaciones Compose. |
| `../.dockerignore` | Copia de `Dockerfile.dockerignore` para plataformas que construyen desde la raíz. |

Desde la raíz:

```sh
docker compose -f deploy/compose.yaml up -d --build
```

O desde esta carpeta:

```sh
docker compose up -d --build
```

Ambos usan el mismo proyecto `modularai`, los mismos volúmenes y `deploy/.env`. No cambia el almacenamiento por mover los archivos Compose.

Para construir solo la imagen desde la raíz:

```sh
docker build -f deploy/Dockerfile -t modularai:local .
```

Docker usa las exclusiones de `Dockerfile.dockerignore` junto al Dockerfile. La imagen final contiene dependencias de producción, backend compilado y assets del panel; no contiene modelos ni servicios de inferencia.

La guía de arranque, autenticación, catálogo y operación está en el [README principal](../README.md). Para Raspberry Pi, Fly.io y Railway consulta la [guía de despliegue](../docs/guides/DEPLOY.md).

El contenedor arranca como `root` solo para dar al usuario `node` la propiedad de los volúmenes y luego baja privilegios (`apps/server/src/entrypoint.ts`). Desde 0.5 el servidor exige credenciales. El perfil `examples` construye una imagen cliente independiente; usa `run --build --rm seed-examples`. Consulta [migración](../docs/guides/MIGRATION-0.5.md) y [agentes/workers](../docs/guides/AGENTS-AND-CAPABILITIES.md).

La [guía del servidor central](../docs/guides/CENTRAL-SERVER.md) describe cómo conectar usuarios de otros equipos. `npm run docker:public` aplica el overlay público; requiere configurar `MODAI_PUBLIC_HOST`, DNS y puertos 80/443. `MODAI_PUBLIC_URL` anuncia la URL en el panel, sin cambiar el enlace de red.
