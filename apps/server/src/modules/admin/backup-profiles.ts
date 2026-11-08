import type { ExecutionPolicy } from "@modai/contracts/types";
import type { DataContext } from "../../infrastructure/database/database.js";
import { insertIgnore } from "../../infrastructure/database/upsert.js";
import { ProfileRepository } from "../profiles/profile.repository.js";
import type { Snapshot } from "./backup-snapshot.js";

export async function exportProfiles(context: DataContext) {
  const { db } = context;
  const teams = await db
    .selectFrom("teams")
    .select(["id", "organization_id as organizationId", "name", "created_at as createdAt"])
    .orderBy("id")
    .execute();
  const teamMembers = await db
    .selectFrom("team_memberships")
    .innerJoin("users", "users.id", "team_memberships.user_id")
    .select(["team_id as teamId", "users.username"])
    .orderBy("team_id")
    .orderBy("users.username")
    .execute();
  const executionPolicies = await db
    .selectFrom("project_execution_policies")
    .selectAll()
    .orderBy("project_id")
    .execute();
  return {
    teams,
    teamMembers,
    bindings: await new ProfileRepository(context).exportAll(),
    executionPolicies: executionPolicies.map((row) => ({
      projectId: row.project_id,
      policy: JSON.parse(row.policy_json) as ExecutionPolicy,
    })),
  };
}

export async function restoreProfiles(context: DataContext, snapshot: Snapshot): Promise<void> {
  for (const team of snapshot.teams ?? [])
    await insertIgnore(
      context,
      "teams",
      {
        id: team.id,
        organization_id: team.organizationId,
        name: team.name,
        created_at: team.createdAt,
      },
      ["id"],
    );
  for (const member of snapshot.teamMembers ?? []) {
    const user = await context.db
      .selectFrom("users")
      .select("id")
      .where("username", "=", member.username)
      .executeTakeFirst();
    if (user)
      await insertIgnore(context, "team_memberships", { team_id: member.teamId, user_id: user.id }, [
        "team_id",
        "user_id",
      ]);
  }
  const bindings = new ProfileRepository(context);
  for (const binding of snapshot.bindings ?? []) await bindings.set(binding);
  for (const item of snapshot.executionPolicies ?? [])
    await insertIgnore(
      context,
      "project_execution_policies",
      { project_id: item.projectId, policy_json: JSON.stringify(item.policy) },
      ["project_id"],
    );
}
