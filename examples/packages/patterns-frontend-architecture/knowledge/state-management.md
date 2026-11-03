# Dónde vive el estado

| Tipo de estado            | Ejemplo                            | Ubicación recomendada                                       |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Efímero de UI             | menú abierto, input sin enviar     | componente local                                            |
| Compartido entre hermanos | filtro que afecta lista y contador | ancestro común                                              |
| De módulo                 | asistente de varios pasos          | contexto/servicio del módulo                                |
| Global de cliente         | sesión, tema, permisos             | store global pequeño                                        |
| De servidor               | listas, detalles remotos           | caché de peticiones (React Query, SWR, servicios con caché) |
| De URL                    | página, filtros compartibles       | parámetros de ruta/búsqueda                                 |

## Señales de mala ubicación

- Sincronizar dos copias del mismo dato con efectos.
- Un store global que contiene respuestas del servidor sin invalidación.
- Prop drilling de más de tres niveles para un dato que solo usa una hoja: considera composición (children/slots) antes que contexto.

## Derivar en lugar de duplicar

Todo lo calculable a partir de otro estado se calcula al renderizar (memoizado si es costoso), no se guarda.
