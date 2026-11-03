# Agente de proyecto

## Inicio

1. Ejecuta `modai status` y lee `.agent/progress.md`.
2. Selecciona como máximo una función `active` en `.agent/feature_list.json`.
3. Consulta `.agent/verification.md` y las skills pertinentes antes de editar.

## Invariantes

- WIP=1: termina, verifica o bloquea la función activa antes de abrir otra.
- El repositorio y los artefactos `.agent/` son la fuente de verdad; el chat no sustituye estado durable.
- Conserva alcance y cambios del usuario. No reescribas áreas no relacionadas.
- No marques `passing` sin ejecutar el gate de la función.
- No ocultes fallos ni debilites pruebas para declarar finalización.
- Registra decisiones durables con `modai memory add` y documentación de proyecto cuando afecten contratos.

## Enrutamiento

- Skills: `.agents/skills/*/SKILL.md`, solo cuando apliquen.
- Estado/alcance: `.agent/feature_list.json` y `.agent/progress.md`.
- Gates: `.agent/verification.md`.
- Continuidad: `.agent/session-handoff.md`.

## Cierre

Deja build y pruebas en estado conocido. Actualiza progreso y handoff con evidencia, cambios, riesgos y la mejor próxima acción.
