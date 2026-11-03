import { invariant } from "@modai/contracts/errors";
import { assertSafeRelativePath, sha256 } from "@modai/contracts/security";
import type { ArtifactFile } from "@modai/contracts/types";

const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export function validateArtifactFiles(files: ArtifactFile[]): Set<string> {
  invariant(Array.isArray(files), 400, "INVALID_ARTIFACT", "files debe ser una lista");
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    assertSafeRelativePath(file.path, "files.path");
    invariant(!paths.has(file.path), 400, "DUPLICATE_FILE", `Archivo duplicado: ${file.path}`);
    paths.add(file.path);
    const decoded = Buffer.from(file.content, "base64");
    total += decoded.byteLength;
    invariant(sha256(decoded) === file.sha256, 400, "HASH_MISMATCH", `Hash incorrecto para ${file.path}`);
  }
  invariant(total <= MAX_ARTIFACT_BYTES, 413, "ARTIFACT_TOO_LARGE", "El artefacto supera 25 MiB");
  return paths;
}
