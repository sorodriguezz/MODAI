export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function invariant(condition: unknown, statusCode: number, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(statusCode, code, message);
}
