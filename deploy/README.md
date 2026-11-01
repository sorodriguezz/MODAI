# Despliegue

Todos los archivos de infraestructura viven aquí:

| Archivo | Responsabilidad |
|---|---|
| `Dockerfile` | Build, pruebas y runtime Node 26.13.0; el contexto es la raíz del repositorio. |
| `Dockerfile.dockerignore` | Exclusiones del contexto para este Dockerfile, incluidos secretos y datos locales. |
| `compose.yaml` | Servidor, volúmenes persistentes y carga opcional de ejemplos. |
| `compose.lan.yaml` | Overlay para HTTPS interno con Caddy. |
| `Caddyfile` | Proxy inverso, TLS interno y cabeceras HTTP. |
| `.env.example` | Plantilla; copia a `.env` en esta carpeta y cambia el token. |

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

Docker usa las exclusiones de `Dockerfile.dockerignore` junto al Dockerfile. La imagen final contiene dependencias de producción, archivos compilados y ejemplos; no contiene modelos ni servicios de inferencia.

La guía de arranque, autenticación, catálogo y operación está en el [README principal](../README.md).
