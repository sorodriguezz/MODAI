# Guía de decisión

Empieza por la presión, no por el diagrama.

| Confusión | Pregunta decisiva |
|---|---|
| Factory Method vs Abstract Factory | ¿Varía un producto mediante extensión de un creador, o debe mantenerse compatible una familia completa? |
| Builder vs Abstract Factory | ¿Necesitas pasos, opciones y representaciones antes de obtener el resultado, o una familia de productos terminados? |
| Prototype vs Factory | ¿La configuración existente es el activo que conviene copiar, o la creación debe expresar tipos y políticas? |
| Adapter vs Facade | ¿Traducimos una interfaz incompatible o ofrecemos una entrada más simple a todo un subsistema? |
| Adapter vs Proxy vs Decorator | Adapter cambia la interfaz; Proxy conserva la interfaz y controla acceso/ciclo de vida; Decorator conserva o amplía la interfaz y añade comportamiento componible. |
| Bridge vs Strategy | Bridge separa dos dimensiones que evolucionan; Strategy intercambia maneras de realizar una operación. |
| Composite vs Decorator | Composite modela parte–todo con múltiples hijos; Decorator apila responsabilidades alrededor de un componente. |
| Strategy vs State | El cliente suele elegir una Strategy; los estados y transiciones pertenecen al ciclo de vida del contexto. |
| Strategy vs Command | Strategy expresa distintas maneras de hacer lo mismo; Command representa una solicitud transportable, diferible, registrable o reversible. |
| Template Method vs Strategy | Template Method fija un esqueleto mediante herencia; Strategy compone comportamiento por objeto y puede cambiar en runtime. |
| Observer vs Mediator | Observer distribuye eventos a suscriptores; Mediator centraliza reglas de colaboración entre componentes. |
| Chain of Responsibility vs Decorator | Una cadena puede manejar, detener o pasar una solicitud; una pila de decoradores mantiene el contrato y añade responsabilidades. |
| Memento vs Prototype | Memento protege una instantánea para restaurar estado; Prototype crea nuevas instancias útiles a partir de un ejemplar. |
| Visitor vs métodos del elemento | Visitor conviene cuando las operaciones cambian más que la jerarquía; si los tipos de elemento cambian seguido, el coste de actualizar visitantes domina. |

## Umbral de adopción

Adopta un patrón cuando puedas mostrar al menos una de estas evidencias:

- dos variantes reales que deben sustituirse sin cambiar al consumidor;
- un límite externo cuya interfaz o ciclo de vida debe aislarse;
- un árbol, máquina de estados o flujo de solicitudes ya presente;
- creación compleja que mezcla decisiones incompatibles con la lógica de negocio;
- cambios repetidos que tocan el mismo condicional o coordinación.

Si solo existe una posibilidad hipotética, registra la decisión y pospone la abstracción.
