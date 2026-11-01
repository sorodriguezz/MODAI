# Patrones creacionales

## Factory Method

Úsalo cuando una jerarquía creadora necesita delegar qué producto concreto construir o un framework expone un punto de extensión. Evítalo si una función fábrica o inyección directa resuelve el caso; demasiadas subclases desplazan la complejidad sin eliminarla.

Evidencia: el consumidor trabaja contra el producto abstracto y una nueva variante no exige modificarlo.

## Abstract Factory

Úsalo cuando debas crear familias de productos que tienen que ser compatibles entre sí —por ejemplo, proveedores completos por plataforma— sin filtrar clases concretas. Evítalo si solo cambia un producto o si añadir un nuevo tipo de producto a todas las familias será frecuente.

Evidencia: una prueba construye cada familia y verifica que nunca mezcla variantes incompatibles.

## Builder

Úsalo para construcción por pasos, múltiples representaciones o parámetros opcionales con invariantes. Un objeto de opciones o constructor nombrado suele ser mejor para casos pequeños. No permitas obtener un producto inválido a mitad del proceso.

Evidencia: las combinaciones válidas son legibles y las inválidas fallan en el límite de construcción.

## Prototype

Úsalo cuando copiar una configuración existente sea más estable que depender del tipo concreto o repetir una inicialización costosa. Define con precisión copia profunda, identidad y propiedad de recursos. Evítalo con grafos cíclicos o recursos externos si la semántica de clonación no es inequívoca.

Evidencia: modificar el clon no altera accidentalmente al original.

## Singleton

Resérvalo para una unicidad que sea un invariante real del proceso, no una comodidad de acceso. Separa “una instancia” de “variable global”, contempla concurrencia y ofrece un seam de prueba. En aplicaciones con inyección de dependencias, un scope de contenedor suele ser más transparente.

Evidencia: pruebas aisladas no comparten estado y la inicialización concurrente mantiene la unicidad.
