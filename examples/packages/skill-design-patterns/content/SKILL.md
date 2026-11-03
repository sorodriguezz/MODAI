---

name: design-patterns
description: Diagnostica y aplica patrones de diseño cuando una presión concreta de creación, estructura o colaboración lo justifica. Úsala para elegir, comparar, implementar o revisar patrones; no para imponer patrones a código simple ni sustituir decisiones de arquitectura de dominio.
---

# Patrones de diseño con evidencia

El objetivo no es “usar un patrón”, sino resolver una presión de cambio con el mecanismo más pequeño que siga siendo claro. Los patrones nombran tradeoffs recurrentes; no son una lista de requisitos.

## Flujo obligatorio

1. Describe el comportamiento actual, la variación esperada y el acoplamiento que duele. Distingue evidencia actual de extensibilidad hipotética.
2. Formula una opción simple sin patrón. Si resuelve el problema y sigue siendo legible, prefiérela.
3. Lee solo la familia pertinente:
   - Creación, familias de objetos, construcción o clonación: [creational.md](references/creational.md).
   - Interfaces, wrappers, árboles, capas o dimensiones ortogonales: [structural.md](references/structural.md).
   - Algoritmos, estados, eventos, solicitudes o recorridos: [behavioral.md](references/behavioral.md).
4. Si dos patrones parecen iguales, consulta [decision-guide.md](references/decision-guide.md). Explica por qué uno encaja y el otro no.
5. Implementa la mínima superficie: una interfaz solo cuando exista más de una implementación real, un límite externo o una variación que ya deba aislarse.
6. Verifica con [verification.md](references/verification.md). El nombre del patrón no es evidencia de calidad.

## Salida esperada

Antes del cambio, deja explícitos:

- presión de diseño y ejemplo observable;
- opción simple considerada;
- patrón elegido y responsabilidad de cada participante;
- coste aceptado: clases, indirección, orden, estado o ciclo de vida;
- condición de retirada si la variación desaparece;
- pruebas que demuestran sustitución, composición o transición.

## Límites

- No crees capas “por si acaso”. Dos duplicaciones pequeñas pueden ser más baratas que una abstracción prematura.
- No uses Singleton como contenedor global de dependencias; prefiere composición explícita.
- No escondas I/O, red o fallos bajo una interfaz que parezca local y barata.
- No conviertas todos los condicionales en Strategy o State: primero evalúa cantidad, frecuencia de cambio y propiedad de las transiciones.
- Conserva el lenguaje del dominio. Los nombres `Factory`, `Manager` o `Handler` no deben borrar conceptos del negocio.
- Respeta el alcance solicitado y las convenciones del repositorio.

Las fuentes y el criterio de síntesis están en [sources.md](references/sources.md).
