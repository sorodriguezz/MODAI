# Servidor MODAI

Aplicación privada que expone la API HTTP: autorización, catálogo, proyectos, contexto, composición de agentes, cola, auditoría y backups.

`src/http/app.ts` registra los endpoints; `src/http/admin-assets.ts` sirve el panel compilado desde `apps/admin/dist`; `src/core/` contiene los servicios y la persistencia; `src/server.ts` configura el proceso.

Se despliega mediante `deploy/Dockerfile` y Compose. Fuera de Docker crea el estado bajo `var/` en esta aplicación; Docker usa volúmenes independientes. El frontend tiene su código propio en `apps/admin`.

Consulta la [guía del servidor central](../../docs/guides/CENTRAL-SERVER.md). Usa Node `>=26.13.0 <27`.
