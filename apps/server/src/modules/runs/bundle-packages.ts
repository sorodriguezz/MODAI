import type { AgentBundle } from "@modai/contracts/types";

export function bundlePackageNames(bundle: AgentBundle): string[] {
  return [
    ...new Set([
      bundle.agent.name,
      ...bundle.packages.map((item) => item.name),
      ...(bundle.effectiveProfile?.packages.map((item) => item.name) ?? []),
    ]),
  ];
}
