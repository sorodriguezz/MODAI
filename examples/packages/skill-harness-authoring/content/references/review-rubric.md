# Rúbrica de revisión

Puntúa 0, 1 o 2 cada criterio y adjunta evidencia.

| Subsistema     | 0                           | 1                       | 2                                          |
| -------------- | --------------------------- | ----------------------- | ------------------------------------------ |
| Instrucciones  | ausentes/enciclopédicas     | guía parcial            | router breve, prioridades y rutas claras   |
| Entorno        | arranque implícito          | comandos incompletos    | cold start reproducible y diagnóstico      |
| Estado         | solo chat                   | progreso manual ambiguo | estado durable, evidencia y próxima acción |
| Alcance        | tareas abiertas sin límite  | criterios narrativos    | WIP, dependencias y gates controlados      |
| Verificación   | confianza del agente        | pruebas parciales       | doble puerta comportamiento + sistema      |
| Ciclo de vida  | sesión termina abruptamente | notas incompletas       | clean state/handoff verificable            |
| Observabilidad | fallo opaco                 | logs básicos            | señales runtime y trazabilidad de decisión |
| Seguridad      | permisos amplios            | algunas prohibiciones   | límites fail-closed y auditoría            |

Interpreta el total como diagnóstico estructural, no como prueba causal. Confirma el cuello de botella con fallos y ejecuciones representativas. Prioriza 2–3 cambios, repite la misma tarea y registra tasa de completitud, tiempo hasta primera verificación y coste de reconstrucción entre sesiones.
