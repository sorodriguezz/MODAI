import type { ManagedEntry } from "@modai/contracts/manifest";
import { assertPermissionsGranted, resolveConflicts } from "./apply-conflicts.js";
import type { DesiredState } from "./desired-state.js";
import { indexPreviousManaged } from "./previous-managed.js";
import { retireUndesired } from "./retire-managed.js";
import { writeDesired } from "./write-desired.js";

export interface ApplyOptions {
  root: string;
  previous: ManagedEntry[];
  desired: DesiredState;
  grants: string[];
  force?: boolean;
  keepMine?: boolean;
}
export interface ApplyResult {
  managed: ManagedEntry[];
  written: string[];
  removed: string[];
  preserved: string[];
  sideBySide: string[];
}

export function applyDesiredState(options: ApplyOptions): ApplyResult {
  const { root, desired } = options;
  assertPermissionsGranted(desired, options.grants);
  const previous = indexPreviousManaged(options.previous);
  const keep = resolveConflicts({ root, desired, previous, keepMine: options.keepMine, force: options.force });
  const { removed, preserved } = retireUndesired(root, desired, previous);
  const { managed, written, sideBySide } = writeDesired(root, desired, previous, keep);
  return { managed, written, removed, preserved, sideBySide };
}
