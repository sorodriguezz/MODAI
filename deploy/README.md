# Despliegue

Infraestructura del [servidor MODAI](../apps/server/README.md). Todos los entornos usan **la misma imagen** (`Dockerfile`, multi-arquitectura amd64/arm64); cambia solo cómo cada plataforma entrega disco, puerto y HTTPS. La imagen contiene dependencias de producción, el backend compilado y los assets del panel; no contiene modelos ni servicios de inferencia.

## Archivos

| Archivo                                             | Responsabilidad                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Dockerfile`                                        | Build, pruebas y runtime Node 26.13.0; el contexto es la raíz del repositorio.                         |
| `Dockerfile.dockerignore`                           | Exclusiones del contexto, incluidos secretos y datos locales (`../.dockerignore` es su copia).         |
| `compose.yaml`                                      | Servidor, volúmenes persistentes y carga opcional de ejemplos (perfil `examples`).                     |
| `compose.lan.yaml`, `Caddyfile`                     | HTTPS interno con la CA de Caddy en el puerto 8443.                                                    |
| `compose.public.yaml`, `Caddyfile.public`           | Dominio público con certificado en los puertos 80/443.                                                 |
| `compose.raspberry.yaml`                            | Raspberry Pi: reinicio, límite de memoria, heap de Node, logs rotados e imagen opcional ya construida. |
| `fly/fly.toml`                                      | Fly.io: una máquina, un volumen en `/app/data`, healthcheck y HTTPS.                                   |
| `railway/railway.json`, `railway/variables.example` | Railway: build con este Dockerfile, healthcheck y variables.                                           |
| `.env.example`                                      | Plantilla de configuración; cópiala a `deploy/.env` (fuera de Git).                                    |
| `backup.sh`                                         | Respaldo en caliente de SQLite y artefactos para instalaciones Compose.                                |

## Reglas comunes

- **Una sola instancia.** Con SQLite, dos réplicas tendrían bases distintas: no escales horizontalmente.
- **Secretos fuera del repositorio**: `MODAI_API_TOKEN` (instalación y recuperación) y, opcionalmente, `MODAI_ADMIN_USERNAME` / `MODAI_ADMIN_PASSWORD`.
- **`MODAI_TRUST_PROXY=true`** cuando un proxy (Caddy, Fly, Railway, Tailscale, Cloudflare) es el único acceso. Así los límites de login usan la IP real y la cookie de sesión sale `Secure`.
- **`MODAI_PUBLIC_URL`** debe coincidir exactamente con la dirección del navegador (protocolo y dominio): es la que ven los clientes y la que se compara con `Origin` en las escrituras del panel.
- El contenedor arranca como `root` solo para dar al usuario `node` (uid 1000) la propiedad de los volúmenes y baja de inmediato; otro uid con `MODAI_RUN_UID` / `MODAI_RUN_GID`.
- Tras el primer arranque, carga el catálogo de ejemplo desde tu equipo (`MODAI_SERVER=https://TU_DIRECCION MODAI_API_TOKEN=… npm run seed:examples`) y conecta la CLI con `modai server connect https://TU_DIRECCION`.

|          | Raspberry Pi / VPS                                                         | Fly.io                                  | Railway                                        |
| -------- | -------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Archivos | `compose.yaml` + overlays                                                  | `fly/fly.toml`                          | `railway/railway.json` + `variables.example`   |
| Disco    | Volúmenes Docker                                                           | Un volumen en `/app/data`               | Un volumen en `/app/data`                      |
| HTTPS    | Caddy (`compose.lan.yaml` / `compose.public.yaml`), Tailscale o Cloudflare | Incluido (`*.fly.dev` o dominio propio) | Incluido (`*.up.railway.app` o dominio propio) |
| Puerto   | 8787                                                                       | 8787                                    | El que inyecta Railway (`PORT`)                |

## Docker Compose

```sh
cp deploy/.env.example deploy/.env       # MODAI_API_TOKEN largo y aleatorio
npm run docker:up                        # docker compose -f deploy/compose.yaml up -d --build
npm run docker:ps
npm run docker:logs
npm run docker:seed                      # catálogo de ejemplo
npm run docker:down                      # conserva los datos
```

Desde la carpeta `deploy/` también vale `docker compose up -d --build`: ambos usan el proyecto `modularai`, los mismos volúmenes (`modularai_modai-data`, `modularai_modai-artifacts`) y `deploy/.env`. **No uses `down -v` si quieres conservar los datos.** Cambiar `deploy/.env` exige recrear el contenedor (`up -d --force-recreate`); `restart` no relee las variables. Para construir solo la imagen: `docker build -f deploy/Dockerfile -t modularai:local .`.

| Acceso                                   | Cómo                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Solo este equipo                         | Por defecto: `MODAI_BIND_IP=127.0.0.1`                                                                                                |
| Red local por HTTP                       | `MODAI_BIND_IP=0.0.0.0` y `MODAI_PUBLIC_URL=http://IP_DEL_HOST:8787`                                                                  |
| Red local por HTTPS                      | `npm run docker:lan`: Caddy publica `https://MODAI_HOSTNAME:8443` con su CA interna; distribúyela solo a clientes autorizados         |
| Dominio público con puertos 80/443       | `MODAI_PUBLIC_HOST` y `npm run docker:public`: Caddy obtiene el certificado y anuncia `https://MODAI_PUBLIC_HOST`                     |
| Desde cualquier lugar, sin abrir puertos | `sudo tailscale serve --bg 8787` o Cloudflare Tunnel hacia `http://localhost:8787`, con `MODAI_PUBLIC_URL` y `MODAI_TRUST_PROXY=true` |

Mantén `MODAI_BIND_IP=127.0.0.1` cuando el acceso es por un proxy o un túnel. `node scripts/deploy.mjs [--lan|--public|--pi] <args de compose>` pasa cualquier otro comando de Compose con los archivos correctos.

## Raspberry Pi

Requisitos: Raspberry Pi 4 o 5 con Raspberry Pi OS de 64 bits y al menos 2 GB de RAM.

```sh
curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER
git clone https://github.com/sorodriguezz/MODAI.git && cd MODAI
cp deploy/.env.example deploy/.env && nano deploy/.env
docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml up -d --build   # o npm run docker:pi
```

La primera compilación puede tardar 10–20 minutos. `compose.raspberry.yaml` agrega `restart: always`, límite de memoria (`MODAI_MEMORY_LIMIT`, 768 MB), heap acotado (`MODAI_NODE_HEAP_MB`) y rotación de logs. Si tienes un SSD por USB, úsalo para Docker: SQLite escribe con frecuencia.

Para no compilar en la Pi, usa la imagen que publica `.github/workflows/docker-image.yml` en GHCR al crear un tag `vX.Y.Z`:

```sh
echo 'MODAI_IMAGE=ghcr.io/sorodriguezz/modai:<versión>' >> deploy/.env
docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml pull server
docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml up -d --no-build
```

Si el paquete de GHCR es privado, ejecuta antes `docker login ghcr.io` con un token con `read:packages`. Para actualizar: `git pull` y repite el `up -d --build` (o `pull` + `up -d --no-build`).

## Fly.io

```sh
fly apps create modai-tu-nombre                      # y escribe el nombre en deploy/fly/fly.toml
fly volumes create modai_data --app modai-tu-nombre --region scl --size 1
fly secrets set --app modai-tu-nombre \
  MODAI_API_TOKEN="$(openssl rand -hex 32)" \
  MODAI_ADMIN_USERNAME=admin MODAI_ADMIN_PASSWORD='una frase larga y difícil' \
  MODAI_PUBLIC_URL=https://modai-tu-nombre.fly.dev
npm run deploy:fly                                   # fly deploy . --config deploy/fly/fly.toml --dockerfile deploy/Dockerfile --ha=false
```

- El volumen va en la misma región que `primary_region`. Guarda `MODAI_API_TOKEN`: `fly secrets list` no lo muestra.
- `--ha=false` es obligatorio: Fly crea dos máquinas por defecto y cada una tendría su propio volumen. No escales con `fly scale count` por encima de 1.
- `auto_stop_machines = "stop"` y `min_machines_running = 0` apagan la máquina sin tráfico; usa `min_machines_running = 1` si tienes workers. Con más uso, sube `memory` en `[[vm]]`.
- Dominio propio: `fly certs add modai.tu-dominio.cl` y actualiza `MODAI_PUBLIC_URL`. Logs: `fly logs`. Respaldos: snapshots del volumen y `modai admin export`.

## Railway

1. **New Project → Deploy from GitHub repo** con este repositorio.
2. **Settings → Config-as-code**: `/deploy/railway/railway.json` (build con `deploy/Dockerfile`, healthcheck `/health` y reinicio ante fallos).
3. **Volumes → Add volume** con _mount path_ `/app/data`.
4. **Variables → Raw Editor**: pega `deploy/railway/variables.example` y reemplaza `MODAI_API_TOKEN` y `MODAI_ADMIN_PASSWORD`. `MODAI_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` toma el dominio solo.
5. **Settings → Networking → Generate Domain** y abre `https://<tu-servicio>.up.railway.app/admin`.

No aumentes las réplicas: el volumen pertenece a una sola instancia. Con la CLI de Railway, `railway up` despliega con la misma configuración.

## Respaldos

```sh
sh deploy/backup.sh ~/modai-backups
COMPOSE_FILES="-f deploy/compose.yaml -f deploy/compose.raspberry.yaml" sh deploy/backup.sh ~/modai-backups
```

Genera `modai-FECHA.db` (copia consistente de SQLite, sin detener el servidor) y `modai-artifacts-FECHA.tgz`; cópialos fuera del host. Con cron: `0 3 * * * cd /home/pi/MODAI && sh deploy/backup.sh /home/pi/modai-backups`. El backup lógico portable es `modai admin export` (o **Auditoría** en el panel). Con PostgreSQL, MySQL o SQL Server usa las herramientas de respaldo del motor.

## Verificar

```sh
curl https://TU_DIRECCION/health
modai server connect https://TU_DIRECCION
modai server whoami
```

Si `/health` responde pero el panel no mantiene la sesión, revisa `MODAI_PUBLIC_URL` y `MODAI_TRUST_PROXY=true` detrás de un proxy HTTPS. Plataformas serverless como Vercel no sirven: el servidor necesita un proceso permanente y disco persistente.
