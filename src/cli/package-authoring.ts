import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import YAML from "yaml";
import { signaturePayload } from "../core/security.js";
import type { PackageType, PublishPackageInput } from "../core/types.js";

function writeNew(path: string, content: string): void {
  if (existsSync(path)) throw new Error(`No se sobrescribió ${path}`);
  writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
}

export function generateSigningKey(directory: string): { privateKey: string; publicKey: string } {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const privatePath = join(root, "modai-ed25519-private.pem");
  const publicPath = join(root, "modai-ed25519-public.pem");
  if (existsSync(privatePath) || existsSync(publicPath)) throw new Error("Ya existe una clave ModularAI en esa carpeta.");
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

export function scaffoldPackage(directory: string, name: string, type: PackageType): string {
  const root = resolve(directory);
  if (existsSync(root)) throw new Error(`La carpeta ya existe: ${root}`);
  mkdirSync(join(root, "content"), { recursive: true });
  const shortName = name.split("/").pop() ?? basename(root);
  const target = type === "skill" ? `.agents/skills/${shortName}/SKILL.md` : `.modai/packages/${shortName}/README.md`;
  const source = type === "skill" ? "content/SKILL.md" : "content/README.md";
  const manifest = {
    schemaVersion: 1,
    name,
    version: "0.1.0",
    type,
    description: `Describe con precisión la capacidad ${name} y cuándo debe utilizarse.`,
    files: [{ source, target }],
    ...(type === "knowledge" ? { knowledge: [{ source, title: shortName, tags: [shortName] }] } : {}),
  };
  writeNew(join(root, "modai.package.yaml"), YAML.stringify(manifest, { lineWidth: 0 }));
  if (type === "skill") {
    writeNew(join(root, source), `---\nname: ${shortName}\ndescription: Explica la capacidad, cuándo se activa y qué solicitudes similares quedan fuera.\n---\n\n# ${shortName}\n\nDefine aquí el resultado esperado, las decisiones no obvias y los límites reales.\n\n## Flujo\n\n1. Inspecciona el contexto relevante.\n2. Ejecuta el trabajo manteniendo el alcance solicitado.\n3. Verifica el resultado con evidencia observable.\n\n## Recursos\n\nAñade references/ solo para detalle condicional que no deba cargarse siempre.\n`);
  } else {
    writeNew(join(root, source), `# ${shortName}\n\nContenido administrado por el paquete ${name}.\n`);
  }
  return root;
}
