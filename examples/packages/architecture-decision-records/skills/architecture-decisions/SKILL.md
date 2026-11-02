---
name: architecture-decisions
description: Evalúa alternativas de arquitectura con trade-offs explícitos y redacta un ADR breve y verificable. Úsala cuando una decisión afecte a varios módulos, sea costosa de revertir o la pida el equipo; no para cambios locales triviales.
---

# Decisiones de arquitectura

1. **Contexto.** Describe la fuerza que obliga a decidir (requisito, incidente, límite de escala) con datos, no opiniones.
2. **Alternativas.** Al menos dos opciones reales, incluida "no cambiar". Para cada una: beneficios, costos, riesgos y reversibilidad.
3. **Criterios.** Ordena los atributos de calidad que importan aquí (por ejemplo: disponibilidad > costo > velocidad de entrega). Ver `references/quality-attributes.md`.
4. **Decisión.** Elige y explica por qué ganó según los criterios. Declara qué se sacrifica.
5. **Consecuencias.** Cambios necesarios, deuda aceptada y señales que obligarían a revisar la decisión.
6. **Registro.** Escribe el ADR en `docs/architecture/ADR-NNN-titulo.md` con estado `Propuesto` hasta que una persona lo acepte.

## Verificación

- Cada alternativa tiene al menos un costo explícito.
- La decisión es falsable: hay una métrica o evento que indicaría que fue equivocada.
- No modifiques código como parte de redactar el ADR salvo que se pida.
