---

name: skill-authoring
description: Crea o revisa SKILL.md y sus recursos cuando una capacidad procedimental deba reutilizarse y activarse con precisión. No la uses para documentación genérica, hechos del proyecto ni instrucciones que pertenecen al harness raíz.
---

# Autoría de skills

Una buena skill cambia decisiones con conocimiento no obvio y carga solo lo necesario. Asume que el agente ya sabe programar, escribir y razonar; no repitas consejos genéricos.

## Flujo

1. Define solicitudes reales que deben activarla y solicitudes parecidas que no.
2. Escribe `name` corto y `description` discriminante: capacidad + condición de uso + límite útil.
3. Mantén en `SKILL.md` propósito, decisiones esenciales, límites y enrutamiento.
4. Mueve esquemas, variantes, catálogos y procedimientos condicionales a `references/`.
5. Usa `scripts/` solo si una operación repetida necesita ejecución determinista.
6. Valida estructura con `modai package validate` y comportamiento con tareas representativas.

Consulta [checklist.md](references/checklist.md) antes de publicar y [quality.md](references/quality.md) cuando una skill crece o se activa mal.

## Límites

- La skill apoya la intención del usuario; no amplía permisos ni alcance.
- Especificidad proporcional al riesgo: pasos rígidos solo para invariantes frágiles o seguridad.
- No conviertas una corrección aislada en regla universal sin evidencia repetida.
- No dupliques manuales externos; enlaza fuentes y conserva solo el criterio que cambia la acción.
- No crees carpetas vacías, README redundante ni ejemplos sin función concreta.
