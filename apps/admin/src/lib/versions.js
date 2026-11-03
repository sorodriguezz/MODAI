// Version rules for publishing: a new version must be SemVer, must not repeat one that exists (versions are
// immutable) and must be greater than the latest one. The server still rejects duplicates; this tells the person
// before they get to the end of the wizard.

const PARSE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version) {
  const match = PARSE.exec(String(version).trim());
  return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split(".") : [] } : null;
}

/** SemVer 2.0 precedence: negative when a < b, 0 when equal, positive when a > b. Throws on a non-SemVer string. */
export function compareVersions(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) throw new Error("Versión no válida");
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length; // a release outranks its prereleases
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

export const latestOf = (versions) => versions.filter((v) => parse(v)).sort(compareVersions).at(-1);

/** The reason `version` cannot be published on top of `existing`, or "" when it can. */
export function versionProblem(version, existing) {
  const value = String(version || "").trim();
  if (!parse(value)) return "La versión debe ser SemVer, por ejemplo 1.2.3.";
  const normalized = value.replace(/^v/, "");
  if (existing.some((v) => v === normalized)) return `La versión ${normalized} ya existe y es inmutable: publica una nueva.`;
  const latest = latestOf(existing);
  if (latest && compareVersions(normalized, latest) < 0) return `La versión debe ser mayor que la última publicada (${latest}).`;
  return "";
}

/** The next patch after the latest published version, as a suggestion. */
export function nextAfter(versions) {
  const latest = latestOf(versions);
  const p = latest && parse(latest);
  return p ? `${p.core[0]}.${p.core[1]}.${p.core[2] + 1}` : "";
}

/**
 * Keeps a version field checked against the versions already published under the current name.
 * `fetchVersions(name)` resolves to the list of published version strings ([] when there are none).
 * Returns `{ problem() }`, a synchronous check for wizard steps based on what was last loaded.
 */
export function bindVersionCheck({ name, input, hint, fetchVersions, defaultHint = "SemVer: 1.2.3", watch = [] }) {
  let known = { name: "", versions: [] };
  let touched = false;
  let token = 0;
  const show = () => {
    const issue = known.name === name() ? versionProblem(input.value, known.versions) : "";
    const latest = known.name === name() ? latestOf(known.versions) : "";
    hint.textContent = issue || (latest ? `Última publicada: ${latest}. SemVer: debe ser mayor.` : defaultHint);
    hint.classList.toggle("invalid", Boolean(issue));
    input.setAttribute("aria-invalid", String(Boolean(issue)));
    return issue;
  };
  const load = async () => {
    const current = name();
    if (!current || current.startsWith("/") || current.endsWith("/")) { known = { name: "", versions: [] }; return show(); }
    const mine = ++token;
    let versions = [];
    try { versions = await fetchVersions(current); } catch { /* no information: the server decides */ }
    if (mine !== token) return;
    known = { name: current, versions };
    if (!touched && versions.length) input.value = nextAfter(versions);
    show();
  };
  input.addEventListener("input", () => { touched = true; show(); });
  for (const element of watch) { element.addEventListener("change", load); element.addEventListener("input", load); }
  load();
  return { problem: () => (known.name === name() ? versionProblem(input.value, known.versions) : versionProblem(input.value, [])) };
}
