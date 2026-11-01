# Checklist de publicación

- [ ] Nombre en minúsculas y guiones, menor de 64 caracteres.
- [ ] Descripción distingue activación y exclusiones relevantes.
- [ ] El cuerpo contiene decisiones no obvias, no un tutorial genérico.
- [ ] El alcance y autorizaciones del usuario se preservan.
- [ ] El entrypoint enlaza cada referencia y explica cuándo leerla.
- [ ] Los scripts nuevos se ejecutaron y verificaron.
- [ ] No hay placeholders, recursos huérfanos ni contenido duplicado.
- [ ] `modai package validate` no informa errores.
- [ ] Una prueba positiva activa y usa correctamente la skill.
- [ ] Una prueba negativa evita activarla para una solicitud similar fuera de alcance.
- [ ] La salida de la prueba se evalúa por comportamiento/evidencia, no por palabras exactas.
