# Verificación de una aplicación de patrón

## Antes

- Escribe un ejemplo del cambio que hoy resulta costoso.
- Identifica el eje de variación, dueño del ciclo de vida y dirección de dependencias.
- Registra la solución simple descartada y por qué deja de ser suficiente.
- Obtén una línea base de pruebas, complejidad o memoria cuando corresponda.

## Durante

- Conserva WIP=1 y migra un flujo vertical completo antes de generalizar.
- Usa nombres del dominio para participantes concretos; el nombre GoF puede quedar en documentación.
- No cambies simultáneamente comportamiento, contrato público y estructura si puedes separar los pasos.
- Añade mensajes de error y señales de runtime en los límites nuevos.

## Puerta de completitud

- El comportamiento observable anterior sigue pasando.
- Hay una prueba por variante, transición, wrapper u operación relevante.
- Una nueva variante representativa se añade sin modificar consumidores que debían quedar cerrados.
- Fallos, orden, concurrencia y ciclo de vida están cubiertos cuando el patrón los introduce.
- El diff reduce el coste de cambio que motivó la decisión; no solo aumenta el número de clases.
- Se documentó cómo retirar la abstracción si deja de aportar valor.

No marques el trabajo como terminado solo porque el diagrama “parece” el patrón.
