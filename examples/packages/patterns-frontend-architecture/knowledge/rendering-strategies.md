# Estrategias de renderizado

## SSG (generación estática)
Contenido que cambia poco y debe cargar muy rápido. Regenera por despliegue o de forma incremental.

## SSR (servidor por petición)
Contenido personalizado o muy cambiante que debe mostrarse sin esperar JavaScript. Cuidado con el tiempo de servidor y la hidratación.

## CSR (cliente)
Aplicaciones internas tras autenticación, donde el SEO no importa y la interacción domina.

## Streaming e islas
Separan partes lentas o interactivas del resto para no bloquear el primer contenido.

## Criterio de elección
Decide con métricas: LCP objetivo, necesidad de SEO, costo de servidor y complejidad de hidratación. Documenta la decisión en un ADR si afecta a varias rutas.
