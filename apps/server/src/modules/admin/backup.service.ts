import type { Database } from "../../infrastructure/database/database.js";
import type { KnowledgeService } from "../knowledge/knowledge.service.js";
import type { MemoryService } from "../memory/memory.service.js";
import type { PackagesService } from "../packages/packages.service.js";
import { exportSnapshot } from "./backup-export.js";
import { restoreSnapshot } from "./backup-restore.js";
import type { ImportResult, Snapshot } from "./backup-snapshot.js";
import { validateSnapshot } from "./backup-validation.js";

export class BackupService {
  constructor(
    private readonly database: Database,
    private readonly packages: PackagesService,
    private readonly knowledge: KnowledgeService,
    private readonly memory: MemoryService,
  ) {}

  export(): Promise<Snapshot> {
    return exportSnapshot(this.database, this.packages);
  }

  // why: all or nothing; every repository the import touches runs on the same transaction executor.
  async import(snapshot: Snapshot): Promise<ImportResult> {
    await validateSnapshot(this.database, snapshot);
    return this.database.transaction((trx) =>
      restoreSnapshot(
        trx,
        {
          packages: this.packages.withContext(trx),
          knowledge: this.knowledge.withContext(trx),
          memory: this.memory.withContext(trx),
        },
        snapshot,
      ),
    );
  }
}
