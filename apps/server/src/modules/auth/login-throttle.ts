const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const MAX_ENTRIES = 10_000;

interface Failure {
  count: number;
  first: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, Failure>();

  isLocked(key: string, now: number): boolean {
    const entry = this.failures.get(key);
    return Boolean(entry && entry.lockedUntil > now);
  }

  fail(key: string, now: number): void {
    const entry = this.failures.get(key);
    const failure = entry && now - entry.first < WINDOW_MS ? entry : { count: 0, first: now, lockedUntil: 0 };
    failure.count += 1;
    if (failure.count >= MAX_FAILURES) failure.lockedUntil = now + WINDOW_MS;
    this.failures.delete(key);
    this.failures.set(key, failure);
    if (this.failures.size > MAX_ENTRIES) this.evict(now);
  }

  clear(key: string): void {
    this.failures.delete(key);
  }

  private evict(now: number): void {
    for (const [other, value] of this.failures)
      if (value.lockedUntil <= now && now - value.first >= WINDOW_MS) this.failures.delete(other);
    for (const other of this.failures.keys()) {
      if (this.failures.size <= MAX_ENTRIES) break;
      this.failures.delete(other);
    }
  }
}
