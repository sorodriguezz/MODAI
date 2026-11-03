---

name: specification-driven-development
description: Convierte una intención en criterios verificables antes de implementar.
---

# Specification-driven development

Para cambios con comportamiento observable:

1. Describe el problema, el usuario afectado y el resultado esperado.
2. Escribe criterios de aceptación concretos, incluyendo errores y límites.
3. Registra decisiones que cambien contratos o arquitectura.
4. Implementa el incremento mínimo que satisface los criterios.
5. Verifica cada criterio con prueba, demostración o evidencia reproducible.

La especificación explica qué debe ser cierto. No debe fijar detalles internos innecesarios. Si aparecen supuestos nuevos durante la implementación, actualiza la especificación antes de cerrar el trabajo.
