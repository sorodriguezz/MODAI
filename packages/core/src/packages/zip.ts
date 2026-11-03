import { deflateRawSync, inflateRawSync } from "node:zlib";
import { assertSafeRelativePath } from "@modai/contracts/security";

export interface ArchiveEntry {
  path: string;
  bytes: Buffer;
}

export const compareArchivePaths = (a: ArchiveEntry, b: ArchiveEntry) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0;

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git|node_modules)(\/|$)/;

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  local: number;
  next: number;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 22 - 0xffff); i--)
    if (archive.readUInt32LE(i) === 0x06054b50) return i;
  throw new Error("El archivo no es un ZIP válido (falta el directorio central)");
}

function readCentralEntry(archive: Buffer, offset: number): CentralEntry {
  if (archive.readUInt32LE(offset) !== 0x02014b50)
    throw new Error("ZIP dañado: entrada del directorio central inválida");
  const nameLength = archive.readUInt16LE(offset + 28);
  const extraLength = archive.readUInt16LE(offset + 30);
  const commentLength = archive.readUInt16LE(offset + 32);
  return {
    flags: archive.readUInt16LE(offset + 8),
    method: archive.readUInt16LE(offset + 10),
    compressed: archive.readUInt32LE(offset + 20),
    size: archive.readUInt32LE(offset + 24),
    local: archive.readUInt32LE(offset + 42),
    name: archive
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8")
      .replaceAll("\\", "/"),
    next: offset + 46 + nameLength + extraLength + commentLength,
  };
}

function assertSupportedEntry(entry: CentralEntry): void {
  if (entry.flags & 1) throw new Error(`ZIP cifrado no admitido: ${entry.name}`);
  if (entry.compressed === 0xffffffff || entry.size === 0xffffffff) throw new Error("ZIP64 no admitido");
  assertSafeRelativePath(entry.name, "archivo del ZIP");
}

function inflateEntry(archive: Buffer, entry: CentralEntry): Buffer {
  const { local, name, method, size } = entry;
  if (archive.readUInt32LE(local) !== 0x04034b50) throw new Error(`ZIP dañado: cabecera local inválida en ${name}`);
  const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
  const data = archive.subarray(start, start + entry.compressed);
  let bytes: Buffer;
  if (method === 0) bytes = Buffer.from(data);
  else if (method === 8) bytes = inflateRawSync(data, { maxOutputLength: size + 1 });
  else throw new Error(`Método de compresión no admitido (${method}) en ${name}`);
  if (bytes.length !== size) throw new Error(`ZIP dañado: tamaño inesperado en ${name}`);
  return bytes;
}

export function readZip(archive: Buffer, limits: { maxBytes?: number } = {}): ArchiveEntry[] {
  const maxBytes = limits.maxBytes ?? MAX_TOTAL_BYTES;
  const end = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  if (count > MAX_ENTRIES) throw new Error(`El ZIP tiene demasiadas entradas (${count}; máximo ${MAX_ENTRIES})`);
  let offset = archive.readUInt32LE(end + 16);
  let total = 0;
  const entries: ArchiveEntry[] = [];
  for (let n = 0; n < count; n++) {
    const entry = readCentralEntry(archive, offset);
    offset = entry.next;
    if (entry.name.endsWith("/") || IGNORED.test(entry.name)) continue;
    assertSupportedEntry(entry);
    total += entry.size;
    if (total > maxBytes)
      throw new Error(`El contenido descomprimido supera ${Math.round(maxBytes / 1024 / 1024)} MiB`);
    entries.push({ path: entry.name, bytes: inflateEntry(archive, entry) });
  }
  return entries.sort(compareArchivePaths);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function writeZip(entries: ArchiveEntry[]): Buffer {
  const locals: Buffer[] = [],
    centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of [...entries].sort(compareArchivePaths)) {
    const name = Buffer.from(entry.path, "utf8"),
      data = deflateRawSync(entry.bytes),
      crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
