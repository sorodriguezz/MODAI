# Estrategia de regresión

## Qué es una regresión
Una prueba que pasaba en la línea base aprobada y ahora falla. Las fallas que ya existían no son regresiones del cambio actual, pero deben seguir visibles.

## Selección de pruebas
Prioriza por riesgo: flujos de dinero, autenticación, datos personales y rutas con más tráfico. Ejecuta primero las pruebas del área modificada y la suite completa antes de liberar.

## Líneas base
Versiona la línea base junto al código (por ejemplo `.regression/baseline.json`) y actualízala solo con aprobación explícita, igual que un snapshot visual.

## Inestabilidad
Las pruebas inestables erosionan la confianza. Regístralas, aíslalas y corrige la causa (esperas explícitas, datos de prueba deterministas) en lugar de reintentos infinitos.
