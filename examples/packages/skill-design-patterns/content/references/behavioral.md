# Patrones de comportamiento

## Chain of Responsibility

Cadena ordenada de manejadores configurables; cada uno maneja, transforma o pasa la solicitud. Define qué ocurre si nadie la atiende y prueba orden/cortocircuito.

## Command

Convierte una intención en objeto cuando necesitas cola, retraso, serialización, auditoría, composición o deshacer. No añadas la capa si una llamada directa es suficiente. Idempotencia y reintentos forman parte del contrato.

## Iterator

Encapsula recorridos complejos o múltiples sin exponer la representación. Los iteradores nativos bastan para colecciones simples. Define modificación concurrente, pausa y finalización.

## Mediator

Centraliza reglas de colaboración para desacoplar componentes. Mantén las decisiones de dominio fuera de un mediador genérico y vigila que no se convierta en un “god object”.

## Memento

Captura y restaura estado sin romper encapsulación. Define tamaño, retención, versión y recursos no serializables. Para transacciones persistentes, usa mecanismos de la base de datos antes que instantáneas en memoria.

## Observer

Distribuye eventos a suscriptores dinámicos. Documenta entrega, orden, reintentos, duplicados, desuscripción y errores; un flujo invisible sin observabilidad es más difícil de mantener que el acoplamiento que reemplaza.

## State

Extrae conducta y transiciones cuando una máquina de estados grande cambia con frecuencia. Mantén explícita la tabla de transiciones y prueba estados inválidos. Para pocos estados estables, un enum y un switch pueden ser superiores.

## Strategy

Intercambia algoritmos bajo un contrato común. El contexto no debe conocer detalles internos, pero el selector sí debe expresar por qué elige una variante. En lenguajes funcionales, funciones de primera clase suelen evitar clases ceremoniales.

## Template Method

Fija la secuencia de un algoritmo y permite variar pasos mediante herencia. Úsalo cuando el esqueleto sea realmente estable; demasiados hooks o pasos opcionales anuncian una jerarquía frágil. Prefiere Strategy si necesitas composición o cambio en runtime.

## Visitor

Agrupa operaciones sobre una jerarquía estable de elementos heterogéneos. Es costoso cuando aparecen nuevos tipos de elemento, porque todos los visitantes cambian. Verifica double dispatch y acceso sin romper encapsulación.
