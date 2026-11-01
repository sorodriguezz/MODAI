# Harness Engineering en ModularAI

La biblioteca incluida sintetiza [Learn Harness Engineering](https://walkinglabs.github.io/learn-harness-engineering/es/) en paquetes instalables y tooling ejecutable. La fuente fue revisada en su edición española: 14 lecciones, 8 proyectos, plantillas, recursos avanzados y análisis de Pi, Claude Code, Codex y DeepSeek Harness.

## Modelo aplicado

Un harness fiable contiene cinco subsistemas:

1. Instrucciones: un router corto, prioridades e invariantes.
2. Herramientas/entorno: bootstrap, permisos y comandos reproducibles.
3. Estado/contexto: progreso durable y progressive disclosure.
4. Alcance: WIP=1, dependencias, estados y evidencia.
5. Feedback/lifecycle: gates ejecutables, clean state y handoff.

`modai harness init` crea el baseline y detecta scripts de Node cuando existen. `modai harness audit` puntúa estructura y ofrece correcciones; esa puntuación no sustituye pruebas con sesiones reales.

## Catálogo

- `@skills/harness-authoring`: construcción y auditoría.
- `@skills/skill-authoring`: skills precisas y progresivas.
- `@skills/design-patterns`: catálogo de Refactoring.Guru convertido en decisiones verificables.
- `@profiles/harness-engineer`: composición de las skills, memoria y MCP.

La skill de patrones se basa en [Refactoring.Guru](https://refactoring.guru/es/design-patterns), pero evita reproducir su contenido. Enruta por familia, compara patrones confundibles, explicita contraindicaciones y exige evidencia antes/después.
