import { sha256 } from "@modai/contracts/security";
import type { BindingTarget, CapabilityBinding } from "@modai/contracts/types";
import type { Selectable } from "kysely";
import type { DataContext } from "../../infrastructure/database/database.js";
import type { CapabilityBindingsTable } from "../../infrastructure/database/schema.js";
import { upsert } from "../../infrastructure/database/upsert.js";

type BindingRow = Selectable<CapabilityBindingsTable>;
const targetColumn = (target: BindingTarget) => `${target.scope}_id` as const;
const bindingId = (target: BindingTarget, slot: string) => sha256(JSON.stringify([target.scope, target.id, slot]));

function bindingOf(row: BindingRow): CapabilityBinding {
  const target: BindingTarget = row.project_id
    ? { scope: "project", id: row.project_id }
    : row.team_id
      ? { scope: "team", id: row.team_id }
      : { scope: "organization", id: row.organization_id! };
  return {
    target,
    slot: row.slot,
    packageName: row.package_name,
    range: row.version_range,
    required: Boolean(row.required),
    ...(row.review_at && row.exception_reason
      ? { exception: { reason: row.exception_reason, reviewAt: row.review_at } }
      : {}),
    approvedBy: row.approved_by,
    updatedAt: row.updated_at,
  };
}

export class ProfileRepository {
  constructor(private readonly context: DataContext) {}

  async list(target: BindingTarget): Promise<CapabilityBinding[]> {
    return (
      await this.context.db
        .selectFrom("capability_bindings")
        .selectAll()
        .where(targetColumn(target), "=", target.id)
        .orderBy("slot")
        .execute()
    ).map(bindingOf);
  }

  async applicable(projectId: string, organizationId?: string, userId?: string): Promise<CapabilityBinding[]> {
    const db = this.context.db;
    const teams =
      organizationId && userId
        ? db
            .selectFrom("team_memberships")
            .innerJoin("teams", "teams.id", "team_memberships.team_id")
            .select("teams.id")
            .where("teams.organization_id", "=", organizationId)
            .where("team_memberships.user_id", "=", userId)
        : undefined;
    return (
      await db
        .selectFrom("capability_bindings")
        .selectAll()
        .where((eb) =>
          eb.or([
            eb("project_id", "=", projectId),
            ...(organizationId ? [eb("organization_id", "=", organizationId)] : []),
            ...(teams ? [eb("team_id", "in", teams)] : []),
          ]),
        )
        .orderBy("slot")
        .orderBy("id")
        .execute()
    ).map(bindingOf);
  }

  async set(binding: CapabilityBinding): Promise<void> {
    const { target, slot } = binding;
    const fields = {
      package_name: binding.packageName,
      version_range: binding.range,
      required: binding.required ? 1 : 0,
      exception_reason: binding.exception?.reason ?? null,
      review_at: binding.exception?.reviewAt ?? null,
      approved_by: binding.approvedBy,
      updated_at: binding.updatedAt,
    };
    await upsert(
      this.context,
      "capability_bindings",
      {
        id: bindingId(target, slot),
        organization_id: null,
        project_id: null,
        team_id: null,
        [targetColumn(target)]: target.id,
        slot,
        ...fields,
      },
      ["id"],
      fields,
    );
  }

  async delete(target: BindingTarget, slot: string): Promise<void> {
    await this.context.db.deleteFrom("capability_bindings").where("id", "=", bindingId(target, slot)).execute();
  }

  async exportAll(): Promise<CapabilityBinding[]> {
    return (await this.context.db.selectFrom("capability_bindings").selectAll().orderBy("id").execute()).map(bindingOf);
  }
}
