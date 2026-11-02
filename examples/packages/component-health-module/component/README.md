# health

`health(checks)` devuelve `{ status, version, uptime, dependencies }`.

```ts
// Express
app.get("/health", async (_req, res) => {
  const body = await health({ db: () => pool.query("SELECT 1").then(() => undefined) });
  res.status(body.status === "ok" ? 200 : 503).json(body);
});
```

El archivo es tuyo: edítalo libremente. `modai remove` conserva los archivos modificados.
