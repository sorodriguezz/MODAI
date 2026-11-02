---
name: regression-testing
description: Planifica, ejecuta y reporta pruebas de regresión comparando contra una línea base aprobada, usando cualquier herramienta que implemente browser.automation. Úsala antes de entregar cambios que afecten flujos de usuario.
---

# Pruebas de regresión

Este procedimiento depende del contrato `browser.automation`, no de una herramienta concreta. Consulta `modai_list_capabilities` para saber qué herramienta lo implementa en este proyecto (por ejemplo `browser_run_tests`).

## Flujo

1. **Plan.** A partir del cambio, lista los flujos de usuario afectados y las pruebas existentes que los cubren. Si faltan pruebas para un flujo crítico, dilo explícitamente.
2. **Ejecuta** la herramienta que implementa `browser.automation`, filtrando primero por los flujos afectados y después la suite completa si el cambio es transversal.
3. **Compara** con `regression_baseline` (`mode: compare`) pasando los resultados tal cual.
4. **Reporta** el veredicto: regresiones (pasaban y ahora fallan), fallas preexistentes, pruebas nuevas y correcciones.
5. **Actualiza la línea base** (`mode: save`) solo cuando una persona aprobó los resultados actuales. Nunca para ocultar una regresión.

## Límites

- No edites pruebas ni la línea base para que el veredicto sea `ok` sin una justificación aprobada.
- Una prueba inestable se repite una vez; si alterna, repórtala como `flaky`, no como corregida.

## Verificación

El entregable incluye el veredicto de `regression_baseline` y el resumen de la ejecución como evidencia.
