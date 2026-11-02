# Desplegar el servidor: Raspberry Pi, Fly.io y Railway

Los tres entornos usan **la misma imagen** (`deploy/Dockerfile`, multi-arquitectura amd64/arm64). Cambia solo cómo cada plataforma entrega disco, puerto y HTTPS:

| | Raspberry Pi | Fly.io | Railway |
|---|---|---|---|
| Archivos | `deploy/compose.yaml` + `deploy/compose.raspberry.yaml` | `deploy/fly/fly.toml` | `deploy/railway/railway.json` + `variables.example` |
| Disco | Volúmenes Docker | Un volumen en `/app/data` | Un volumen en `/app/data` |
| HTTPS | Caddy (`compose.lan.yaml` / `compose.public.yaml`), Tailscale o Cloudflare Tunnel | Incluido (`*.fly.dev` o dominio propio) | Incluido (`*.up.railway.app` o dominio propio) |
| Puerto | 8787 | 8787 (`MODAI_PORT`) | El que inyecta Railway (`PORT`) |
| Costo | Tu hardware | Por uso de máquina y volumen | Por uso y volumen |

Reglas comunes:

- **Una sola instancia.** MODAI guarda datos en SQLite; dos réplicas tendrían bases distintas. No escales horizontalmente.
- **Secretos fuera del repositorio**: `MODAI_API_TOKEN` (token de instalación y recuperación) y, opcionalmente, `MODAI_ADMIN_USERNAME` / `MODAI_ADMIN_PASSWORD` para crear el primer administrador.
- **`MODAI_TRUST_PROXY=true`** cuando un proxy (Caddy, Fly, Railway, Tailscale, Cloudflare) es el único acceso al servidor. Así los límites de intentos de login usan la IP real del cliente y la cookie de sesión sale marcada `Secure`.
- El contenedor arranca como `root` solo para ajustar la propiedad del volumen y baja de inmediato al usuario `node` (uid 1000). Para otro uid usa `MODAI_RUN_UID` / `MODAI_RUN_GID`.
- Después del primer arranque, carga el catálogo de ejemplo desde tu equipo:
  ```sh
  MODAI_SERVER=https://TU_DIRECCION MODAI_API_TOKEN=TU_TOKEN npm run seed:examples
  ```
- Conecta la CLI con `modai connect https://TU_DIRECCION` y crea las API keys por persona en **Conectar un cliente** del panel.

## Raspberry Pi

Requisitos: Raspberry Pi 4 o 5 con **Raspberry Pi OS de 64 bits** (arm64) y al menos 2 GB de RAM. La imagen no soporta sistemas de 32 bits.

```sh
# 1. Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # vuelve a iniciar sesión

# 2. Código y configuración
git clone https://github.com/sorodriguezz/MODAI.git && cd MODAI
cp deploy/.env.example deploy/.env
nano deploy/.env                 # MODAI_API_TOKEN largo y aleatorio; MODAI_ADMIN_* opcional

# 3. Construir y arrancar (la primera compilación en la Pi puede tardar 10–20 minutos)
docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml up -d --build
docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml ps
```

Con Node en la Pi, `npm run docker:pi` hace lo mismo.

`compose.raspberry.yaml` agrega `restart: always`, un límite de memoria (`MODAI_MEMORY_LIMIT`, 768 MB por defecto), un heap de Node acotado (`MODAI_NODE_HEAP_MB`) y rotación de logs para cuidar la tarjeta SD. Si tienes un SSD por USB, úsalo para Docker: SQLite escribe con frecuencia.

**Sin compilar en la Pi.** El workflow `.github/workflows/docker-image.yml` publica `ghcr.io/sorodriguezz/modai` para amd64 y arm64 al crear un tag `vX.Y.Z`, o al lanzarlo manualmente desde Actions. Después, en la Pi:

```sh
echo 'MODAI_IMAGE=ghcr.io/sorodriguezz/modai:0.6.0' >> deploy/.env
docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml pull server
docker compose -f deploy/compose.yaml -f deploy/compose.raspberry.yaml up -d --no-build
```

Si el paquete de GHCR es privado, ejecuta antes `docker login ghcr.io` con un token que tenga `read:packages`, o márcalo como público en GitHub.

**Acceso:**

| Necesidad | Cómo |
|---|---|
| Solo tu red, HTTPS | Agrega `-f deploy/compose.lan.yaml`; entra por `https://MODAI_HOSTNAME:8443` |
| Desde cualquier lugar, sin abrir puertos | [Tailscale](https://tailscale.com): `sudo tailscale serve --bg 8787` publica `https://<pi>.<tailnet>.ts.net` dentro de tu tailnet. Define `MODAI_PUBLIC_URL` con esa dirección y `MODAI_TRUST_PROXY=true` |
| Dominio público, sin abrir puertos | Cloudflare Tunnel hacia `http://localhost:8787`, con `MODAI_PUBLIC_URL` y `MODAI_TRUST_PROXY=true` |
| Dominio público, con puertos 80/443 abiertos | `-f deploy/compose.public.yaml` y `MODAI_PUBLIC_HOST` (Caddy obtiene el certificado) |

Mantén `MODAI_BIND_IP=127.0.0.1` cuando el acceso es por un proxy o un túnel.

**Respaldos** (en caliente, sin detener el servidor):

```sh
COMPOSE_FILES="-f deploy/compose.yaml -f deploy/compose.raspberry.yaml" sh deploy/backup.sh ~/modai-backups
# cron diario a las 03:00:
# 0 3 * * * cd /home/pi/MODAI && COMPOSE_FILES="-f deploy/compose.yaml -f deploy/compose.raspberry.yaml" sh deploy/backup.sh /home/pi/modai-backups
```

Genera `modai-FECHA.db` (copia consistente de SQLite) y `modai-artifacts-FECHA.tgz`. Copia ambos fuera de la Pi.

**Actualizar:** `git pull` y repite el `up -d --build` (o `pull` + `up -d --no-build` con `MODAI_IMAGE`).

## Fly.io

Requisitos: [flyctl](https://fly.io/docs/flyctl/install/) y una cuenta (`fly auth login`).

```sh
# 1. Elige un nombre único y escríbelo en deploy/fly/fly.toml (app = "...")
fly apps create modai-tu-nombre

# 2. Volumen persistente en la misma región que primary_region (scl = Santiago; ver `fly platform regions`)
fly volumes create modai_data --app modai-tu-nombre --region scl --size 1

# 3. Secretos
fly secrets set --app modai-tu-nombre \
  MODAI_API_TOKEN="$(openssl rand -hex 32)" \
  MODAI_ADMIN_USERNAME=admin \
  MODAI_ADMIN_PASSWORD='una frase larga y difícil' \
  MODAI_PUBLIC_URL=https://modai-tu-nombre.fly.dev

# 4. Desplegar desde la raíz del repositorio
npm run deploy:fly
# equivale a: fly deploy . --config deploy/fly/fly.toml --dockerfile deploy/Dockerfile --ha=false
```

Abre `https://modai-tu-nombre.fly.dev/admin`. Guarda el valor de `MODAI_API_TOKEN`: `fly secrets list` no lo muestra.

- `--ha=false` es obligatorio: Fly crea dos máquinas por defecto y cada una tendría su propio volumen.
- `auto_stop_machines = "stop"` y `min_machines_running = 0` apagan la máquina sin tráfico (el volumen conserva los datos); la primera petición la despierta en unos segundos. Pon `min_machines_running = 1` si usas workers o quieres respuesta inmediata.
- Con más uso, sube `memory` en la sección `[[vm]]`.
- Dominio propio: `fly certs add modai.tu-dominio.cl --app modai-tu-nombre`, apunta el DNS y actualiza `MODAI_PUBLIC_URL`.
- Respaldos: Fly toma snapshots periódicos del volumen (`fly volumes snapshots list`). Además, exporta un backup lógico desde **Auditoría** en el panel o con `modai admin export`.
- Logs: `fly logs --app modai-tu-nombre`.

## Railway

1. **New Project → Deploy from GitHub repo** y elige el repositorio.
2. En el servicio, **Settings → Config-as-code**, fija la ruta del archivo de configuración en `/deploy/railway/railway.json`. Así Railway construye con `deploy/Dockerfile`, comprueba `/health` y reinicia ante fallos.
3. **Volumes → Add volume** con *mount path* `/app/data`.
4. **Variables → Raw Editor**: pega el contenido de `deploy/railway/variables.example` y reemplaza `MODAI_API_TOKEN` y `MODAI_ADMIN_PASSWORD`. `MODAI_PUBLIC_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}` toma el dominio automáticamente.
5. **Settings → Networking → Generate Domain**. Railway enruta al puerto que inyecta en `PORT`, y MODAI lo usa.
6. Despliega y abre `https://<tu-servicio>.up.railway.app/admin`.

Con la CLI de Railway (`railway login`, `railway link`), `railway up` despliega el directorio actual con la misma configuración.

- No aumentes las réplicas: el volumen pertenece a una sola instancia. Un servicio con volumen tiene una breve interrupción en cada redespliegue.
- Respaldos: usa los backups de volumen de Railway si tu plan los incluye y exporta además desde **Auditoría** o con `modai admin export`.

## Verificar un despliegue

```sh
curl https://TU_DIRECCION/health            # versión, apiVersion y publicUrl
modai connect https://TU_DIRECCION          # pega MODAI_API_TOKEN o una API key del panel
modai whoami
```

Si `/health` responde pero el panel no mantiene la sesión, revisa que `MODAI_PUBLIC_URL` coincida exactamente con la dirección del navegador (protocolo y dominio) y que `MODAI_TRUST_PROXY=true` esté definido detrás de un proxy HTTPS. Las escrituras del panel comprueban el origen de la petición.
