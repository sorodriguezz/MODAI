import { createHmac, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(secret: Buffer): string {
  let value = 0;
  let bits = 0;
  let encoded = "";
  for (const byte of secret) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32[(value >>> bits) & 31];
    }
  }
  if (bits) encoded += BASE32[(value << (5 - bits)) & 31];
  return encoded;
}

export function totp(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export function matchingTotpStep(secret: Buffer, input: string, now = Date.now()): number | undefined {
  if (!/^\d{6}$/.test(input)) return undefined;
  const code = Buffer.from(input);
  const current = Math.floor(now / 30_000);
  return [current, current - 1, current + 1].find(
    (step) => step >= 0 && timingSafeEqual(code, Buffer.from(totp(secret, step))),
  );
}
