import type { PackageManifestV1 } from "@modai/contracts/manifest";
import { selectPackageFeatures } from "@modai/core";
import type { Command } from "commander";
import { assertKnownFeatures, installedManifest } from "../../services/features.js";
import { requireProject } from "../../services/project.js";
import { runSync } from "../../services/sync.js";
import type { Print } from "../../terminal/output.js";
import { summarize } from "../../terminal/sync-summary.js";

type Update = (choice: Record<string, boolean>, manifest: PackageManifestV1) => void;

async function change(name: string, update: Update, verb: string, print: Print): Promise<void> {
  const root = requireProject();
  const { manifest, active: before } = installedManifest(root, name);
  const { report } = await runSync(root, (file) => {
    const choice = { ...(file.features[name] ?? {}) };
    update(choice, manifest);
    file.features[name] = choice;
    selectPackageFeatures(manifest, choice);
  });
  const after = report.lock.packages[name]?.features ?? [];
  const previous = before.join(",") !== after.join(",") ? ` (antes: ${before.join(", ") || "ninguna"})` : "";
  print(`${verb} en ${name}. Features activas: ${after.join(", ") || "ninguna"}${previous}.\n${summarize(report)}`);
}

export function registerFeatureEnable(feature: Command, print: Print): void {
  feature
    .command("enable")
    .alias("on")
    .description("Activa features de un paquete instalado (y las que requieren)")
    .argument("<package>")
    .argument("<features...>")
    .action((name: string, names: string[]) =>
      change(
        name,
        (choice, manifest) => {
          assertKnownFeatures(manifest, names);
          for (const value of names) choice[value] = true;
        },
        `Activado ${names.join(", ")}`,
        print,
      ),
    );
}

export function registerFeatureDisable(feature: Command, print: Print): void {
  feature
    .command("disable")
    .alias("off")
    .description("Quita features de un paquete instalado, incluidas las que vienen por defecto")
    .argument("<package>")
    .argument("<features...>")
    .action((name: string, names: string[]) =>
      change(
        name,
        (choice, manifest) => {
          assertKnownFeatures(manifest, names);
          for (const value of names) choice[value] = false;
        },
        `Quitado ${names.join(", ")}`,
        print,
      ),
    );
}

export function registerFeatureReset(feature: Command, print: Print): void {
  feature
    .command("reset")
    .description("Vuelve a los valores por defecto del paquete (todas o las indicadas)")
    .argument("<package>")
    .argument("[features...]")
    .action((name: string, names: string[] = []) =>
      change(
        name,
        (choice, manifest) => {
          assertKnownFeatures(manifest, names);
          for (const value of names.length ? names : Object.keys(choice)) delete choice[value];
        },
        names.length ? `Restablecido ${names.join(", ")}` : "Restablecidas las features",
        print,
      ),
    );
}
