// Feature express: monta el router con app.use(healthRouter).
import { Router } from "express";
import { health } from "./health";

export const healthRouter = Router();
healthRouter.get("/health", async (_request, response) => {
  const result = await health();
  response.status(result.status === "ok" ? 200 : 503).json(result);
});
