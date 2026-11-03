# Métricas del health module

La feature `metrics` añade `metrics.ts`, que devuelve métricas del proceso en el formato de texto de Prometheus.

- Expón la función en `GET /metrics` y configura Prometheus para recogerla (`scrape_interval` de 15 a 30 s).
- Las métricas incluidas son `process_uptime_seconds`, `process_resident_memory_bytes` y `nodejs_heap_used_bytes`.
- Para métricas de negocio, añade líneas con el mismo formato: `# HELP`, `# TYPE` y el valor.
- No expongas `/metrics` a internet: protégelo en la red interna o con autenticación.
