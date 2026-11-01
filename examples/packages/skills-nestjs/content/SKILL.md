---
name: nestjs
description: Implementa módulos NestJS pequeños, validables y desacoplados.
---

# NestJS

Antes de editar, identifica el módulo, sus proveedores y el límite transaccional. Usa DTOs con validación en el borde y conserva las reglas de negocio fuera de controllers y decoradores.

- Controllers: traducción HTTP y códigos de estado.
- Casos de uso: orquestación de reglas.
- Repositorios: interfaces del lado consumidor.
- Módulos: composición explícita; evita módulos globales salvo infraestructura transversal real.
- Pruebas: unitarias para casos de uso e integración para pipes, guards y adaptadores.

No conviertas cada clase en una abstracción. Introduce un puerto cuando separa una dependencia externa o permite expresar una necesidad estable del negocio.
