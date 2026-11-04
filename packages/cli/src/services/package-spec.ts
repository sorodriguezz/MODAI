import semver from "semver";

export function splitPackageSpec(spec: string): { name: string; range: string } {
  const separator = spec.lastIndexOf("@");
  if (!spec.startsWith("@") || !spec.includes("/"))
    throw new Error(`Paquete inválido: ${spec}. Usa @scope/nombre[@rango].`);
  if (separator > spec.indexOf("/")) return { name: spec.slice(0, separator), range: spec.slice(separator + 1) || "*" };
  return { name: spec, range: "*" };
}

export function exactVersion(spec: string): { name: string; version: string } {
  const item = splitPackageSpec(spec);
  if (!semver.valid(item.range)) throw new Error("Indica una versión exacta: @scope/nombre@1.2.3");
  return { name: item.name, version: item.range };
}

export function splitVersionSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  return at > spec.indexOf("/")
    ? { name: spec.slice(0, at), version: spec.slice(at + 1) || undefined }
    : { name: spec };
}

export function agentSpec(spec: string): { name: string; range: string } {
  const i = spec.lastIndexOf("@");
  return i > spec.indexOf("/") ? { name: spec.slice(0, i), range: spec.slice(i + 1) } : { name: spec, range: "*" };
}
