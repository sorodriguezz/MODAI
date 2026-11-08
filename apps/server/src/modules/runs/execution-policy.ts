import type { ExecutionPolicy } from "@modai/contracts/types";
import type { DataContext } from "../../infrastructure/database/database.js";
import { upsert } from "../../infrastructure/database/upsert.js";

export class ExecutionPolicies {
  constructor(private readonly context: DataContext) {}

  async get(projectId: string): Promise<ExecutionPolicy | undefined> {
    const row = await this.context.db
      .selectFrom("project_execution_policies")
      .select("policy_json")
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    return row ? (JSON.parse(row.policy_json) as ExecutionPolicy) : undefined;
  }

  async set(projectId: string, policy: ExecutionPolicy): Promise<void> {
    const policy_json = JSON.stringify(policy);
    await upsert(this.context, "project_execution_policies", { project_id: projectId, policy_json }, ["project_id"], {
      policy_json,
    });
  }

  async delete(projectId: string): Promise<void> {
    await this.context.db.deleteFrom("project_execution_policies").where("project_id", "=", projectId).execute();
  }
}
