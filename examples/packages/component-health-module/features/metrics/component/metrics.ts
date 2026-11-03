// Feature metrics: métricas del proceso en formato de texto de Prometheus, sin dependencias.
export function metrics(): string {
  const memory = process.memoryUsage();
  const lines = [
    "# HELP process_uptime_seconds Tiempo desde que arrancó el proceso.",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime().toFixed(0)}`,
    "# HELP process_resident_memory_bytes Memoria residente.",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${memory.rss}`,
    "# HELP nodejs_heap_used_bytes Heap usado por V8.",
    "# TYPE nodejs_heap_used_bytes gauge",
    `nodejs_heap_used_bytes ${memory.heapUsed}`,
  ];
  return `${lines.join("\n")}\n`;
}
