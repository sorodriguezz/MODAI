---
name: hexagonal-architecture
description: Diseña y revisa servicios con puertos, adaptadores y un dominio independiente.
---

# Arquitectura hexagonal

Mantén las reglas del negocio dentro del dominio y evita importar frameworks, bases de datos o transportes desde él.

- Los puertos de entrada expresan casos de uso.
- Los puertos de salida expresan necesidades del dominio, no detalles de infraestructura.
- Los adaptadores implementan HTTP, persistencia, colas y servicios externos.
- La composición de dependencias ocurre en el borde de la aplicación.

Al diseñar una función, empieza por el lenguaje del negocio, define el puerto mínimo y añade el adaptador después. Prueba el dominio con dobles de sus puertos; reserva pruebas de integración para los adaptadores. Una dependencia que apunta desde el dominio hacia NestJS, Prisma o PostgreSQL cruza el límite en la dirección incorrecta.

Estructura orientativa:

```text
src/
  domain/
  application/
    ports/
    use-cases/
  infrastructure/
    http/
    persistence/
```
