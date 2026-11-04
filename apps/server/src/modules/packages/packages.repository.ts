import type { Insertable } from "kysely";
import { type DataContext, withTransaction } from "../../infrastructure/database/database.js";
import type { ArtifactsTable, KnowledgeDocumentsTable, PackagesTable } from "../../infrastructure/database/schema.js";
import { affectedRows, escapeLike, likeLower, toNumber } from "../../infrastructure/database/sql-helpers.js";
import type { PackageRow } from "./package-record.js";

export class PackagesRepository {
  constructor(private readonly context: DataContext) {}

  list(query?: string, type?: string, includeYanked = false): Promise<PackageRow[]> {
    let select = this.context.db.selectFrom("packages").selectAll();
    if (query) {
      const pattern = `%${escapeLike(query.toLowerCase())}%`;
      select = select.where((eb) => eb.or([likeLower("name", pattern), likeLower("description", pattern)]));
    }
    if (type) select = select.where("type", "=", type);
    if (!includeYanked) select = select.where("status", "<>", "yanked");
    return select.orderBy("name").orderBy("published_at", "desc").execute();
  }

  summaryRows() {
    return this.context.db
      .selectFrom("packages")
      .select(["name", "version", "type", "status", "published_at as publishedAt"])
      .orderBy("published_at", "desc")
      .execute();
  }

  byName(name: string): Promise<PackageRow[]> {
    return this.context.db.selectFrom("packages").selectAll().where("name", "=", name).execute();
  }

  byNameVersion(name: string, version: string): Promise<PackageRow | undefined> {
    return this.context.db
      .selectFrom("packages")
      .selectAll()
      .where("name", "=", name)
      .where("version", "=", version)
      .executeTakeFirst();
  }

  async count(): Promise<number> {
    const row = await this.context.db
      .selectFrom("packages")
      .select((eb) => eb.fn.countAll().as("n"))
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async storageBytes(): Promise<number> {
    const row = await this.context.db
      .selectFrom("artifacts")
      .select((eb) => eb.fn.sum("size_bytes").as("n"))
      .executeTakeFirst();
    return toNumber(row?.n);
  }

  async insertArtifact(row: Insertable<ArtifactsTable>): Promise<void> {
    await this.context.db.insertInto("artifacts").values(row).execute();
  }

  async insertPackage(row: Insertable<PackagesTable>): Promise<void> {
    await this.context.db.insertInto("packages").values(row).execute();
  }

  async insertKnowledge(row: Insertable<KnowledgeDocumentsTable>): Promise<void> {
    await this.context.db.insertInto("knowledge_documents").values(row).execute();
  }

  async artifactOwner(id: string): Promise<string | undefined> {
    const row = await this.context.db
      .selectFrom("packages")
      .select("name")
      .where("artifact_id", "=", id)
      .executeTakeFirst();
    return row?.name;
  }

  async artifactHash(id: string): Promise<string | undefined> {
    const row = await this.context.db.selectFrom("artifacts").select("sha256").where("id", "=", id).executeTakeFirst();
    return row?.sha256;
  }

  async setStatus(name: string, version: string, status: string, message: string, keepYanked: boolean) {
    let query = this.context.db
      .updateTable("packages")
      .set({ status, deprecated_message: message })
      .where("name", "=", name)
      .where("version", "=", version);
    if (keepYanked) query = query.where("status", "<>", "yanked");
    return affectedRows(await query.executeTakeFirst());
  }

  async deleteVersion(name: string, version: string, artifactId: string): Promise<void> {
    await withTransaction(this.context, async ({ db }) => {
      await db
        .deleteFrom("knowledge_documents")
        .where("package_name", "=", name)
        .where("package_version", "=", version)
        .execute();
      await db.deleteFrom("packages").where("name", "=", name).where("version", "=", version).execute();
      await db.deleteFrom("artifacts").where("id", "=", artifactId).execute();
    });
  }
}
