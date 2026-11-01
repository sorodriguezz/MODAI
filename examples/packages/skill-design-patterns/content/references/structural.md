# Patrones estructurales

## Adapter

Traduce una interfaz existente o externa al contrato que necesita el consumidor. Mantén la conversión fuera del dominio y prueba errores, unidades y nulabilidad. No lo uses si puedes corregir directamente el servicio que controlas.

## Bridge

Separa dos dimensiones ortogonales que deben crecer de forma independiente. Exige ejemplos reales en ambos ejes; con una sola dimensión, la composición directa es suficiente.

## Composite

Modela árboles parte–todo donde hojas y contenedores comparten operaciones significativas. No generalices la interfaz hasta incluir métodos sin sentido para las hojas. Verifica recursión, ciclos y agregación.

## Decorator

Añade responsabilidades componibles conservando el contrato base. Documenta si el orden cambia el resultado, cómo se inspecciona la pila y quién la construye. Para una sola variación estable, una función envolvente puede ser más clara.

## Facade

Ofrece un caso de uso sencillo y estable sobre un subsistema complejo o una capa. No debe convertirse en un objeto omnisciente: divide fachadas por capacidad y conserva acceso controlado a operaciones avanzadas cuando sea necesario.

## Flyweight

Comparte estado intrínseco inmutable solo después de medir que una enorme cantidad de objetos repetidos consume memoria relevante. Explicita el estado extrínseco en cada llamada. Incluye una medición antes/después; sin ella es optimización especulativa.

## Proxy

Conserva el contrato del servicio mientras controla acceso, carga diferida, caché, remoto, auditoría o ciclo de vida. No escondas latencia o fallos de red como si fueran una llamada local. Verifica autorización, invalidación de caché y comportamiento cuando el servicio no está disponible.
