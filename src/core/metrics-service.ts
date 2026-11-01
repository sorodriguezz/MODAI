export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, number>();

  observe(method: string, route: string, statusCode: number): void {
    const key = `${method}|${route}|${statusCode}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
  }

  prometheus(): string {
    const lines = [
      "# HELP modai_uptime_seconds Process uptime in seconds.",
      "# TYPE modai_uptime_seconds gauge",
      `modai_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
      "# HELP modai_http_requests_total HTTP requests handled.",
      "# TYPE modai_http_requests_total counter",
    ];
    for (const [key, value] of this.requests) {
      const [method, route, status] = key.split("|");
      lines.push(`modai_http_requests_total{method="${method}",route="${route.replaceAll('"', '\\"')}",status="${status}"} ${value}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
