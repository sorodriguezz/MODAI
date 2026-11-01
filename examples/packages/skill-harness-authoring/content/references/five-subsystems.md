# Cinco subsistemas

## 1. Instrucciones

Un `AGENTS.md`/`CLAUDE.md` breve contiene inicio, invariantes, enrutamiento y cierre. Mantén decisiones específicas cerca de su módulo y carga detalle bajo demanda. Cada regla debe tener razón, condición de aplicabilidad y posible caducidad.

## 2. Herramientas y entorno

El bootstrap debe poder instalar, iniciar, probar y diagnosticar sin conocimiento oral. Clasifica herramientas por llamada: solo lecturas probadamente seguras pueden concurrir. Protege secretos, `.git`, infraestructura y operaciones irreversibles.

## 3. Estado y contexto

Externaliza función activa, evidencia, bloqueos y siguiente acción. Usa un índice pequeño y temas bajo demanda. Escribe conocimiento durable; selecciona solo lo pertinente; comprime historial viejo; aísla trabajo delegado.

## 4. Alcance

Cada función es `(conducta observable, gate, estado)` con estados `not_started`, `active`, `blocked`, `passing`. WIP=1 es el default. Las dependencias y exclusiones deben ser visibles; una sesión termina una unidad vertical antes de abrir otra.

## 5. Feedback y ciclo de vida

Combina sintaxis/tipos, pruebas de comportamiento y validación end-to-end. Los fallos deben indicar cómo recuperarse. Cada sesión deja un clean state o revierte al último estado consistente; el handoff registra verificado, cambiado, roto, siguiente paso y comandos.

## Capas superiores

Un loop añade objetivo, verificación y condición de parada. Un grafo añade nodos, aristas, estado compartido y routing. No introduzcas estas capas hasta que una ejecución individual sea reproducible y observable.
