import { AppError } from "@modai/contracts/errors";
import type { FastifyInstance } from "fastify";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details, requestId: request.id } });
    }
    request.log.error(error);
    const generic = error as { statusCode?: number; message?: string };
    const statusCode = typeof generic?.statusCode === "number" ? generic.statusCode : 500;
    return reply.code(statusCode).send({
      error: {
        code: statusCode === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR",
        message: statusCode >= 500 ? "Error interno" : generic.message,
        requestId: request.id,
      },
    });
  });
}
