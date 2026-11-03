import type { Database } from "./database.js";

export interface InstalledPackageReport { name: string; version: string; direct?: boolean }
export interface PackageUsage { projectId: string; projectName: string; version: string; direct: boolean; reportedAt: string }

/** Which projects use which package versions, as reported by clients after each sync. */
export class UsageService {
  constructor(private readonly db: Database) {}

  /** Replaces the project's installation set; an empty list means nothing is installed any more. */
  report(projectId: string, packages: InstalledPackageReport[]): void {
    const connection = this.db.connection;
    const now = new Date().toISOString();
    connection.transaction(() => {
      connection.prepare("DELETE FROM project_installations WHERE project_id = ?").run(projectId);
      const insert = connection.prepare("INSERT INTO project_installations (project_id, package_name, version, direct, reported_at) VALUES (?, ?, ?, ?, ?)");
      for (const item of packages) insert.run(projectId, item.name, item.version, item.direct ? 1 : 0, now);
    }).immediate();
  }

  /** Projects using `name`; `visible` limits the answer to projects the caller may see. */
  usage(name: string, visible: (projectId: string) => boolean): PackageUsage[] {
    const rows = this.db.connection.prepare(`SELECT i.project_id AS projectId, p.name AS projectName, i.version, i.direct, i.reported_at AS reportedAt
      FROM project_installations i JOIN projects p ON p.id = i.project_id WHERE i.package_name = ? ORDER BY p.name`).all(name) as Array<Omit<PackageUsage, "direct"> & { direct: number }>;
    return rows.filter(row => visible(row.projectId)).map(row => ({ ...row, direct: Boolean(row.direct) }));
  }
}
