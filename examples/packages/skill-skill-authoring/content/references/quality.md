# Diagnóstico de calidad

## Descubrimiento

La metadata siempre está visible y debe ser barata. Si la descripción es una lista genérica o esconde la condición de uso al final, la skill se activa mal. Usa lenguaje distintivo al principio.

## Señal/ruido

Mide cada sección contra tareas reales: si rara vez cambia una decisión, muévela a una referencia o elimínala. Un archivo largo no es automáticamente mejor; desplaza código y contexto relevantes.

## Progressive disclosure

Nivel 1: nombre/descripción. Nivel 2: flujo e invariantes comunes en `SKILL.md`. Nivel 3: detalle por modo en referencias. No obligues a leer todas las variantes.

## Verificación

Prueba activación, límites, resultado observable y seguridad. Los validadores de frontmatter solo detectan estructura; no demuestran buenas decisiones. Cuando una skill compleja falle, corrige el mecanismo concreto y repite el caso, sin acumular reglas universales.

## Mantenimiento

Registra la fuente de reglas no obvias, su condición de aplicación y cuándo podrían retirarse. Audita contradicciones y contenido obsoleto como deuda técnica.
