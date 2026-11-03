import { AppError } from "@modai/contracts/errors";
import { sha256 } from "@modai/contracts/security";

const BEGIN = (id: string) => `<!-- modai:begin ${id} -->`;
const END = (id: string) => `<!-- modai:end ${id} -->`;
const BLOCK_PATTERN = /\n*<!-- modai:begin ([^ ]+) -->[\s\S]*?<!-- modai:end \1 -->\n*/g;

export function managedContentHash(content: Buffer): string {
  if (!content.includes("<!-- modai:begin ")) return sha256(content);
  return sha256(content.toString("utf8").replace(BLOCK_PATTERN, "\n").replace(/^\n+/, "").replace(/\n+$/, "\n"));
}

export function findBlock(content: string, id: string): { start: number; end: number; body: string } | undefined {
  const start = content.indexOf(BEGIN(id));
  const endMarker = content.indexOf(END(id));
  if (start < 0 && endMarker < 0) return undefined;
  if (start < 0 || endMarker < start) throw new AppError(409, "BLOCK_CORRUPT", `Bloque MODAI '${id}' incompleto`);
  const end = endMarker + END(id).length;
  return {
    start,
    end,
    body: content
      .slice(start + BEGIN(id).length, endMarker)
      .replace(/^\n/, "")
      .replace(/\n$/, ""),
  };
}

function renderBlock(id: string, body: string): string {
  return `${BEGIN(id)}\n${body}\n${END(id)}`;
}

export function upsertBlock(content: string, id: string, body: string): string {
  const block = findBlock(content, id);
  if (block) return content.slice(0, block.start) + renderBlock(id, body) + content.slice(block.end);
  return `${content}${content && !content.endsWith("\n") ? "\n" : ""}${content ? "\n" : ""}${renderBlock(id, body)}\n`;
}

export function removeBlock(content: string, id: string): string {
  const block = findBlock(content, id);
  if (!block) return content;
  return (content.slice(0, block.start).replace(/\n+$/, "\n") + content.slice(block.end).replace(/^\n+/, "")).replace(
    /^\n+/,
    "",
  );
}
