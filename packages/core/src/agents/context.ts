import { existsSync, readFileSync } from "node:fs";
import type { PackageManifestV1 } from "@modai/contracts/manifest";
import { safeProjectPath, writeProjectFile } from "../installation/fs.js";

export interface KnowledgeChunk {
  id: string;
  package: string;
  version: string;
  path: string;
  title: string;
  heading?: string;
  tags: string[];
  text: string;
}
export interface ContextIndex {
  version: 1;
  chunks: KnowledgeChunk[];
}
export interface SearchHit {
  id: string;
  score: number;
  package: string;
  version: string;
  path: string;
  title: string;
  heading?: string;
  snippet: string;
}

export const CONTEXT_INDEX_PATH = ".modai/context-index.json";
const STOPWORDS = new Set(
  "a al algo ante como con de del el en es esa ese esta este la las lo los mas no o para pero por que se si sin su sus un una uno y the a an and are as at be by for from how in is it of on or that the this to was what when where which with".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}_]+/gu) ?? []
  ).filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function chunkMarkdown(text: string, maxLength = 1800): Array<{ heading?: string; text: string }> {
  const sections: Array<{ heading?: string; text: string }> = [];
  let heading: string | undefined,
    buffer: string[] = [];
  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      for (let offset = 0; offset < body.length; offset += maxLength)
        sections.push({ heading, text: body.slice(offset, offset + maxLength) });
    }
    buffer = [];
  };
  for (const line of text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").split(/\r?\n/)) {
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) {
      flush();
      heading = match[1].trim();
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

export function buildContextIndex(
  units: Array<{ name: string; version: string; manifest: PackageManifestV1; files: Map<string, Buffer> }>,
): ContextIndex {
  const chunks: KnowledgeChunk[] = [];
  for (const unit of units) {
    for (const document of unit.manifest.spec.contributes.knowledge) {
      const content = unit.files.get(document.path)?.toString("utf8") ?? "";
      for (const [index, chunk] of chunkMarkdown(content).entries())
        chunks.push({
          id: `${unit.name}:${document.path}#${index}`,
          package: unit.name,
          version: unit.version,
          path: document.path,
          title: document.title,
          heading: chunk.heading,
          tags: document.tags,
          text: chunk.text,
        });
    }
  }
  return { version: 1, chunks };
}

export function saveContextIndex(root: string, index: ContextIndex): void {
  writeProjectFile(root, CONTEXT_INDEX_PATH, JSON.stringify(index));
}

export function loadContextIndex(root: string): ContextIndex {
  const path = safeProjectPath(root, CONTEXT_INDEX_PATH);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ContextIndex) : { version: 1, chunks: [] };
}

export function rank<T>(
  documents: T[],
  query: string,
  fields: (item: T) => { strong: string; body: string },
  limit = 8,
): Array<{ item: T; score: number }> {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !documents.length) return [];
  const tokenized = documents.map((item) => {
    const value = fields(item);
    return [...tokenize(value.strong), ...tokenize(value.strong), ...tokenize(value.body)];
  });
  const average = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length || 1;
  const frequency = new Map<string, number>();
  for (const tokens of tokenized)
    for (const term of new Set(tokens)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const k1 = 1.2,
    b = 0.75,
    total = documents.length;
  const matches = (token: string, term: string) => token === term || (term.length >= 4 && token.startsWith(term));
  const documentFrequency = new Map(
    terms.map((term) => [
      term,
      [...frequency.entries()]
        .filter(([token]) => matches(token, term))
        .reduce((max, [, value]) => Math.max(max, value), 0) || 1,
    ]),
  );
  return tokenized
    .map((tokens, index) => {
      let score = 0;
      for (const term of terms) {
        const tf = tokens.filter((token) => matches(token, term)).length;
        if (!tf) continue;
        const df = documentFrequency.get(term)!;
        const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
        score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * tokens.length) / average));
      }
      return { item: documents[index], score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(limit, 1), 50));
}

export function searchKnowledge(
  index: ContextIndex,
  query: string,
  options: { limit?: number; packages?: string[]; tags?: string[] } = {},
): SearchHit[] {
  const candidates = index.chunks.filter(
    (chunk) =>
      (!options.packages?.length || options.packages.includes(chunk.package)) &&
      (!options.tags?.length || options.tags.some((tag) => chunk.tags.includes(tag))),
  );
  return rank(
    candidates,
    query,
    (chunk) => ({ strong: `${chunk.title} ${chunk.heading ?? ""} ${chunk.tags.join(" ")}`, body: chunk.text }),
    options.limit ?? 6,
  ).map(({ item, score }) => ({
    id: item.id,
    score: Math.round(score * 1000) / 1000,
    package: item.package,
    version: item.version,
    path: item.path,
    title: item.title,
    heading: item.heading,
    snippet: item.text.slice(0, 500),
  }));
}

export function readKnowledgeChunk(index: ContextIndex, id: string): KnowledgeChunk | undefined {
  return index.chunks.find((chunk) => chunk.id === id);
}
