import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { signaturePayload } from "@modai/contracts/security";
import type { PublishPackageInput } from "@modai/contracts/types";
import YAML from "yaml";

function writeNew(path: string, content: string): void {
  if (existsSync(path)) throw new Error(`No se sobrescribió ${path}`);
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
}

export function generateSigningKey(directory: string): { privateKey: string; publicKey: string } {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const privatePath = join(root, "modai-ed25519-private.pem");
  const publicPath = join(root, "modai-ed25519-public.pem");
  if (existsSync(privatePath) || existsSync(publicPath))
    throw new Error("Ya existe una clave ModularAI en esa carpeta.");
  const pair = generateKeyPairSync("ed25519");
  writeNew(privatePath, pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  writeNew(publicPath, pair.publicKey.export({ type: "spki", format: "pem" }).toString());
  if (process.platform !== "win32") chmodSync(privatePath, 0o600);
  return { privateKey: privatePath, publicKey: publicPath };
}

export function signPackage(input: PublishPackageInput, privateKeyPem: string): PublishPackageInput {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  const signature = sign(null, signaturePayload(input.manifest, input.files), privateKey).toString("base64");
  return { ...input, signature: { algorithm: "ed25519", publicKey, signature } };
}
