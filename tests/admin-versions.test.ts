import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, latestOf, nextAfter, versionProblem } from "../apps/admin/src/shared/lib/versions.js";

test("las versiones se comparan con la precedencia de SemVer", () => {
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
  assert.ok(compareVersions("2.0.0", "10.0.0") < 0);
  assert.ok(compareVersions("1.0.0", "1.0.0-rc.1") > 0);
  assert.ok(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10") < 0);
  assert.ok(compareVersions("1.0.0-alpha", "1.0.0-alpha.1") < 0);
  assert.equal(compareVersions("1.2.3", "1.2.3+build"), 0);
  assert.equal(latestOf(["0.9.0", "1.10.0", "1.2.0", "1.10.0-rc.1"]), "1.10.0");
  assert.equal(nextAfter(["1.2.0", "1.1.9"]), "1.2.1");
});

test("una versión nueva debe ser SemVer, no repetirse y superar la última publicada", () => {
  const existing = ["1.0.0", "1.2.0", "1.1.0"];
  assert.match(versionProblem("1.2", existing), /SemVer/);
  assert.match(versionProblem("1.1.0", existing), /ya existe/);
  assert.match(versionProblem("1.0.5", existing), /mayor que la última publicada \(1\.2\.0\)/);
  assert.equal(versionProblem("1.2.1", existing), "");
  assert.equal(versionProblem("0.1.0", []), "");
});
