import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class ArtifactStore {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }

  private path(id: string): string {
    return join(this.directory, `${id}.json`);
  }

  create(id: string, body: string): void {
    writeFileSync(this.path(id), body, { encoding: "utf8", flag: "wx" });
  }

  read(id: string): string {
    return readFileSync(this.path(id), "utf8");
  }

  remove(id: string): void {
    rmSync(this.path(id), { force: true });
  }
}
