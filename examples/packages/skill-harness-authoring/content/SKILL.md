---

name: harness-authoring
description: Crea o audita harnesses para agentes de programación cuando haya deriva, pérdida de contexto, sobrealcance o cierres sin verificar. No sustituye arquitectura de producto, selección de modelos ni un simple prompt de tarea.
---

# Autoría de harnesses

Un harness es el sistema de trabajo fuera del modelo: instrucciones, herramientas/entorno, estado, alcance y feedback. Empieza por el fallo observable y mejora el subsistema que lo causa; no acumules reglas indiscriminadamente.

## Crear

1. Inspecciona instrucciones, scripts, CI, estado y documentación existentes.
2. Ejecuta `modai harness init` para un baseline adaptado al proyecto, o crea los artefactos equivalentes sin sobrescribir trabajo del usuario.
3. Reemplaza placeholders por comandos ejecutables y una primera función observable.
4. Ejecuta `modai harness audit` y corrige primero la dimensión más débil.
5. Prueba con una tarea real y compara evidencia antes/después.

Lee [five-subsystems.md](references/five-subsystems.md) al diseñar o corregir un subsistema. Usa [review-rubric.md](references/review-rubric.md) para evaluación y handoff.

## Invariantes

- El archivo raíz es un router corto; el detalle condicional vive cerca del código o en docs temáticas.
- Mantén WIP=1 salvo que existan propietarios y aislamiento explícitos.
- El agente no promueve una función a `passing`; lo hace su gate ejecutable.
- El final de sesión deja build/pruebas en estado conocido, progreso actualizado y siguiente acción inequívoca.
- Los permisos fallan cerrado para operaciones sensibles; lectura y escritura no comparten clasificación por defecto.
- Persistencia durable en repositorio o servicio, no en historial de chat.
- Separa maker y checker cuando la consecuencia o duración justifique evaluación independiente.

## Salida

Entrega artefactos creados, comandos verificados, puntuación por subsistema, limitaciones y la primera mejora priorizada. No declares que el harness es eficaz solo por su estructura: exige sesiones representativas.
