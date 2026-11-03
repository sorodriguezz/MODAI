// Feature nestjs: expone el health check como GET /health en NestJS.
import { Controller, Get, HttpCode, HttpStatus, Res } from "@nestjs/common";
import { health } from "./health";

@Controller("health")
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  async get(@Res({ passthrough: true }) response: { status(code: number): void }) {
    const result = await health();
    if (result.status !== "ok") response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
