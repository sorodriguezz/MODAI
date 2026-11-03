---

name: frontend-architecture
description: Decide límites de componentes, ubicación del estado, estrategia de renderizado y presupuestos de rendimiento en aplicaciones frontend (React, Angular, Vue). Úsala al diseñar o revisar una pantalla o módulo; no para estilos visuales puntuales.
---

# Arquitectura frontend

Objetivo: que cada decisión de estructura tenga un motivo verificable y el menor costo de cambio posible.

## Flujo

1. **Delimita la superficie.** Identifica la ruta o el módulo afectado y quién consume sus datos. No reestructures áreas fuera del alcance pedido.
2. **Ubica el estado** con la regla de menor alcance: local al componente → elevado al ancestro común → contexto/servicio del módulo → store global solo si varias rutas lo leen y escriben. Estado de servidor (caché de peticiones) se gestiona aparte del estado de UI. Consulta `modai_search_knowledge` con "estado" para la matriz completa.
3. **Define límites de componentes** por responsabilidad y frecuencia de cambio, no por tamaño: contenedores (datos, efectos) separados de presentacionales (props → UI). Un componente que necesita más de ~7 props suele mezclar responsabilidades.
4. **Elige renderizado** según requisitos medibles: SSR/SSG si el primer contenido visible y el SEO importan; CSR si es una herramienta interna detrás de login; streaming/islas si hay partes lentas independientes.
5. **Fija presupuestos**: LCP < 2,5 s, INP < 200 ms, CLS < 0,1 en dispositivo medio; JS inicial de la ruta acotado y justificado.
6. **Accesibilidad como requisito**, no como pulido: semántica nativa primero, foco visible, navegación por teclado, contraste AA.

## Verificación

- Cada estado nuevo tiene un dueño único y una razón escrita para su alcance.
- Las métricas de rendimiento se miden (Lighthouse/Web Vitals) antes y después del cambio.
- Si el proyecto tiene la capacidad `browser.automation`, ejecuta las pruebas E2E afectadas con la herramienta que la implementa (consulta `modai_list_capabilities`) y reporta evidencia.
- No declares completado sin evidencia; explica las limitaciones si no puedes ejecutar la aplicación.
