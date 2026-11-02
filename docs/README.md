# Documentación de MODAI

Empieza por el [README del proyecto](../README.md) para entender el producto y levantar el servidor.

## Plataforma de paquetes (0.6)

- [ADR-004: MODAI como plataforma de paquetes y capacidades](architecture/ADR-004-package-platform.md).
- [Especificación de paquetes v1](spec/PACKAGE-SPEC-v1.md): manifiesto, capacidades, contribuciones, permisos, adaptadores, `modai.yaml` y `modai.lock`.
- [Crear, publicar e instalar paquetes](guides/AUTHORING-PACKAGES.md).
- [Migración a 0.6](guides/MIGRATION-0.6.md).
- [Panel web: inicio de sesión, usuarios y roles](guides/ADMIN-PANEL.md).

## Guías

- [Servidor central y conexión de usuarios](guides/CENTRAL-SERVER.md).
- [Publicar solamente el CLI en npm](guides/PUBLISH-CLI.md).
- [Organización de aplicaciones y paquetes](architecture/PROJECT-LAYOUT.md).

- [API HTTP](guides/API.md): rutas, autenticación y contratos.
- [Administración](guides/MANAGEMENT.md): paquetes, credenciales, backups, retención y LAN.
- [MCP](guides/MCP.md): conexión de agentes y herramientas disponibles.
- [Modelos del cliente](guides/CLIENT-MODELS.md): hardware, selección local, embeddings y búsqueda semántica.
- [Harness engineering](guides/HARNESS-ENGINEERING.md): instrucciones, estado y verificación.

## Decisiones de arquitectura

- [ADR 001: distribución e integración de capacidades](architecture/ADR-001.md).
- [ADR 002: modelos e inferencia en el cliente](architecture/ADR-002-client-inference.md).

- [Agentes, capacidades, CLI independiente y workers](guides/AGENTS-AND-CAPABILITIES.md).
- [Migración a 0.5](guides/MIGRATION-0.5.md).
- [ADR 003: composición y ejecución de agentes](architecture/ADR-003-agent-composition.md).
