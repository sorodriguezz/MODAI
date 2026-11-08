import { AppError } from "@modai/contracts/errors";
import type { CapabilityBinding } from "@modai/contracts/types";
import type { PackageReader } from "../auth/authorization.service.js";

const precedence = { organization: 0, team: 1, project: 2 } as const;
const sameSelection = (a: CapabilityBinding, b: CapabilityBinding) =>
  a.packageName === b.packageName && a.range === b.range;

function chooseBinding(items: CapabilityBinding[], visible: PackageReader, now: string): CapabilityBinding | undefined {
  const sorted = [...items].sort((a, b) => precedence[b.target.scope] - precedence[a.target.scope]);
  const winner = sorted.find((item) => item.required) ?? sorted[0];
  if (!visible(winner.packageName)) return undefined;
  const slot = items.every((item) => visible(item.packageName)) ? winner.slot : "una capacidad del perfil";
  const different = sorted.filter((item) => !sameSelection(winner, item));
  if (!different.length) return winner;
  if (winner.required || different.some((item) => item.target.scope === winner.target.scope))
    throw new AppError(409, "BINDING_CONFLICT", `Hay asignaciones incompatibles para ${slot}`);
  if (!winner.exception || winner.exception.reviewAt <= now)
    throw new AppError(
      409,
      "BINDING_EXCEPTION_REQUIRED",
      `La excepción para ${slot} requiere justificación y revisión vigente`,
    );
  return winner;
}

export function effectiveBindings(
  items: CapabilityBinding[],
  visible: PackageReader,
  now: string,
): CapabilityBinding[] {
  const slots = new Map<string, CapabilityBinding[]>();
  for (const binding of items) {
    if (binding.required && !visible(binding.packageName))
      throw new AppError(
        403,
        "REQUIRED_BINDING_FORBIDDEN",
        "La identidad no puede acceder a una capacidad obligatoria",
      );
    const existing = slots.get(binding.slot);
    if (existing) existing.push(binding);
    else slots.set(binding.slot, [binding]);
  }
  return [...slots.values()].flatMap((slot) => {
    const binding = chooseBinding(slot, visible, now);
    return binding ? [binding] : [];
  });
}
