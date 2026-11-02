---
name: playwright-e2e
description: Ejecuta e interpreta pruebas end-to-end con Playwright mediante la herramienta browser_run_tests. Úsala para verificar flujos de usuario; no para pruebas unitarias.
---

# Pruebas E2E con Playwright

1. Identifica el flujo afectado por el cambio y filtra con `grep` para obtener evidencia rápida.
2. Ejecuta `browser_run_tests`. Si responde que Playwright no está instalado, informa el comando de instalación; no lo instales sin autorización.
3. Ante un fallo, reporta título, archivo y el error resumido; distingue fallos reales de pruebas inestables (`flaky`) repitiendo una sola vez.
4. No modifiques las pruebas para que pasen sin explicar por qué el comportamiento esperado cambió.

Verificación: entrega el resumen `passed/failed/flaky/skipped` de la última ejecución como evidencia.
