// Visual package authoring: build a modai.dev/v1 manifest and its files in the browser, validate
// them against the server rubric and publish an immutable version. Same artifact as `modai package publish`.
import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post } from "../lib/api.js";
import { openDialog, closeDialog, setBusy, toast, toastError } from "../lib/ui.js";
import { base64ToBytes, bytesToText, cleanPath, formatBytes, textToBytes, toArtifactFiles } from "../lib/files.js";
import { store } from "../state.js";

const MAX_BYTES = 25 * 1024 * 1024;
const IGNORED = /(^|\/)(node_modules|\.git|dist|\.DS_Store|Thumbs\.db)(\/|$)/;
const slug = (value, fallback = "item") => String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || fallback;

const TEMPLATES = {
  component: {
    label: "Componente de código", icon: "code", category: "component", root: "component",
    text: "Módulos de backend, componentes de UI, servicios… Se copian al proyecto y el usuario puede adaptarlos.",
    starter: (s) => ({
      "component/README.md": `# ${s.component.name || "mi-componente"}\n\nQué resuelve este componente, cómo se integra y qué dependencias espera.\n`,
      "component/index.ts": `// Punto de entrada de ${s.component.name || "mi-componente"}.\nexport {};\n`,
    }),
  },
  harness: {
    label: "Harness", icon: "layers", category: "harness", root: "harness",
    text: "Instrucciones, estado, verificación y handoff para que el agente trabaje de forma fiable.",
    starter: () => ({
      "harness/AGENTS.md": "# Instrucciones del agente\n\n## Inicio\n\n1. Lee `.agent/progress.md`.\n2. Trabaja en una sola función a la vez (WIP=1).\n\n## Cierre\n\nRegistra la evidencia en `.agent/verification.md` y actualiza el handoff.\n",
      "harness/.agent/progress.md": "# Progreso\n\n## Estado verificado actual\n\n- Función activa: ninguna\n\n## Próxima acción\n\nPendiente.\n",
      "harness/.agent/verification.md": "# Verificación\n\n## Gates ejecutables\n\n- `npm test`\n\n## Definition of Done\n\n- El comportamiento tiene evidencia reproducible.\n",
      "harness/.agent/session-handoff.md": "# Entrega de sesión\n\n## Verificado ahora\n\nPendiente.\n\n## Mejor próximo paso\n\nPendiente.\n",
      "harness/.agent/feature_list.json": `${JSON.stringify({ schemaVersion: 1, wipLimit: 1, features: [] }, null, 2)}\n`,
    }),
  },
  skill: {
    label: "Skill", icon: "spark", category: "skill", root: "skills",
    text: "Instrucciones que el agente carga bajo demanda (SKILL.md y referencias).",
    starter: (s) => ({ [`skills/${s.skill}/SKILL.md`]: `---\nname: ${s.skill}\ndescription: Explica qué logra esta skill, cuándo debe activarse y qué queda fuera de su alcance.\n---\n\n# ${s.skill}\n\n## Flujo\n\n1. Inspecciona el contexto relevante.\n2. Ejecuta el trabajo manteniendo el alcance solicitado.\n3. Verifica el resultado con evidencia observable.\n` }),
  },
  knowledge: {
    label: "Conocimiento", icon: "book", category: "knowledge", root: "knowledge",
    text: "Documentos que el agente consulta con búsqueda, sin cargarlos completos en el prompt.",
    starter: () => ({ "knowledge/README.md": "# Guía\n\nConocimiento que el agente recupera bajo demanda.\n" }),
  },
  blank: { label: "Paquete vacío", icon: "package", category: "general", root: "", text: "Edita el manifiesto a mano: perfiles, herramientas, adaptadores…", starter: () => ({}) },
};

/** Permission needed by a raw file target (mirrors requiredTargetPermission in @modai/contracts). */
function harnessPermission(target) {
  if (/^(?:\.agents\/(?:skills|harness)\/|\.modai\/(?:packages|adapters|integrations)\/)/.test(target)) return null;
  if (/^(?:AGENTS\.md|CLAUDE\.md|\.agent\/|\.opencode\/agents\/)/.test(target)) return "project.instructions";
  if (/^docs\//.test(target)) return "project.files";
  throw new Error("Un harness solo instala AGENTS.md, CLAUDE.md, .agent/, .opencode/agents/, .agents/harness/ o docs/: " + target);
}

function buildManifest(s) {
  const paths = [...s.files.keys()].sort();
  const spec = { category: s.meta.category || TEMPLATES[s.template].category };
  const contributes = {};
  const permissions = new Set();
  if (s.template === "component") {
    contributes.components = [{ name: slug(s.component.name, "component"), path: "component", target: s.component.target || "src/modules/{component}", tags: [],
      ...(s.meta.description ? { description: s.meta.description.slice(0, 1000) } : {}), ...(s.component.language ? { language: s.component.language } : {}) }];
    permissions.add("project.source");
  } else if (s.template === "harness") {
    contributes.files = paths.filter((path) => path.startsWith("harness/")).map((source) => {
      const target = source.slice("harness/".length);
      const permission = harnessPermission(target);
      if (permission) permissions.add(permission);
      return { source, target };
    });
  } else if (s.template === "skill") {
    const names = [...new Set(paths.filter((path) => /^skills\/[^/]+\/SKILL\.md$/.test(path)).map((path) => path.split("/")[1]))];
    contributes.skills = names.map((name) => ({ name, path: "skills/" + name }));
  } else if (s.template === "knowledge") {
    contributes.knowledge = paths.filter((path) => /^knowledge\/.+\.(md|txt)$/i.test(path)).map((path) => {
      const heading = (bytesToText(s.files.get(path).bytes) || "").match(/^#\s+(.+)$/m)?.[1]?.trim();
      return { path, title: (heading || path.split("/").pop()).slice(0, 300), tags: [] };
    });
  }
  if (Object.keys(contributes).length) spec.contributes = contributes;
  if (permissions.size) spec.permissions = [...permissions].sort();
  return { apiVersion: "modai.dev/v1", kind: "Package", metadata: { name: s.meta.name, version: s.meta.version, description: s.meta.description, ...(s.meta.license ? { license: s.meta.license } : {}) }, spec };
}

/** Applies the form's identity fields to a hand-edited or existing manifest (v1 or legacy). */
function withIdentity(manifest, meta) {
  const next = structuredClone(manifest);
  if (next.apiVersion === "modai.dev/v1") Object.assign((next.metadata ??= {}), { name: meta.name, version: meta.version, description: meta.description });
  else Object.assign(next, { name: meta.name, version: meta.version, description: meta.description });
  return next;
}

function bumpPatch(version) {
  const match = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : "0.1.0";
}

function qualityMarkup(quality) {
  const tone = { error: "danger", warning: "warning", info: "info" };
  return html`<div class="callout tone-${quality.score >= 80 ? "success" : quality.score >= 50 ? "warning" : "danger"}">${icon(quality.score >= 50 ? "check" : "alert")}<span><b>Calidad estructural ${quality.score}/100.</b> ${quality.findings?.some((f) => f.severity === "error") ? "Corrige los errores antes de publicar." : "Puedes publicar."}</span></div>
    ${quality.findings?.length ? html`<ul class="findings">${quality.findings.map((f) => html`<li class="tone-${tone[f.severity] || "info"}">${icon(f.severity === "info" ? "info" : "alert", 16)}<span><code>${f.code}</code> ${f.message}</span></li>`)}</ul>` : ""}`;
}

/**
 * Opens the editor. With `base` (a package record) it prepares the next version of that package,
 * preloading its manifest and files; otherwise it starts from a template.
 */
export async function openPackageEditor({ base, template = "component", onPublished } = {}) {
  const s = {
    template: base ? "existing" : template,
    meta: { name: base?.name || "", version: base ? bumpPatch(base.version) : "0.1.0", description: base?.description || "", category: "", license: "" },
    component: { name: "", target: "src/modules/{component}", language: "" },
    skill: "mi-skill",
    files: new Map(),
    manifestText: "",
    manifestDirty: Boolean(base),
    starter: new Set(),
    editing: null,
    folderEdit: null,
  };
  if (base) {
    try {
      const artifact = await get("/artifacts/" + encodeURIComponent(base.artifactId));
      for (const file of artifact.files) s.files.set(file.path, { bytes: base64ToBytes(file.content) });
    } catch (error) {
      return toastError(error);
    }
    s.manifestText = JSON.stringify(base.manifest, null, 2);
  }

  const body = openDialog({
    title: base ? "Nueva versión de " + base.name : "Crear paquete",
    description: base ? "Parte de la versión " + base.version + ". Las versiones publicadas son inmutables: esto publica una versión nueva." : "Elige qué quieres compartir, añade los archivos y publícalo en este servidor.",
    size: "lg",
    body: html`<form class="stack" novalidate>
      ${base ? "" : html`<fieldset class="field"><legend>Tipo</legend><div class="role-options">${Object.entries(TEMPLATES).map(([id, t]) => html`
        <label class="role-option"><input type="radio" name="template" value="${id}" ${id === s.template ? "checked" : ""}><span><b>${icon(t.icon, 16)} ${t.label}</b><span class="muted small">${t.text}</span></span></label>`)}</div></fieldset>`}
      <div class="field-row">
        <div class="field"><label for="pkgName">Nombre</label><input id="pkgName" required pattern="@[a-z0-9][a-z0-9._\\-]*\\/[a-z0-9][a-z0-9._\\-]*" placeholder="@acme/auth-module" value="${s.meta.name}" ${base ? "readonly" : ""}><p class="hint">@namespace/nombre, en minúsculas.</p></div>
        <div class="field"><label for="pkgVersion">Versión</label><input id="pkgVersion" required pattern="\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.\\-]+)?" value="${s.meta.version}"><p class="hint">SemVer: 1.2.3</p></div>
      </div>
      <div class="field"><label for="pkgDescription">Descripción</label><textarea id="pkgDescription" rows="2" required maxlength="5000" placeholder="Qué aporta, cuándo usarlo y qué espera del proyecto.">${s.meta.description}</textarea></div>
      <div id="templateFields"></div>
      <section class="stack">
        <div class="toolbar">
          <h3 style="margin:0;flex:1">Archivos <span class="count" id="fileCount">0</span></h3>
          <button type="button" class="btn small" data-action="newFile">${icon("plus", 16)}Nuevo archivo</button>
          <label class="btn small">${icon("download", 16)}Subir archivos<input type="file" id="uploadFiles" multiple hidden></label>
          <label class="btn small">${icon("folder", 16)}Subir carpeta<input type="file" id="uploadFolder" webkitdirectory multiple hidden></label>
        </div>
        <p class="hint" id="uploadHint"></p>
        <div id="fileEditor"></div>
        <div id="fileList"></div>
      </section>
      <details class="disclosure" ${base || s.template === "blank" ? "open" : ""}><summary>Manifiesto (modai.package.yaml en JSON)</summary>
        <p class="hint">Se genera desde el formulario. Si lo editas a mano, tus cambios se respetan al publicar.</p>
        <textarea id="pkgManifest" class="mono" rows="14" spellcheck="false"></textarea>
        <div class="dialog-actions" style="justify-content:flex-start"><button type="button" class="btn small ghost" data-action="regenerate">${icon("refresh", 16)}Regenerar desde el formulario</button></div>
      </details>
      <div id="validation" aria-live="polite"></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="button" class="btn" data-action="validate">${icon("check")}Validar</button><button type="submit" class="btn primary">${icon("package")}Publicar</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  const $ = (id) => form.querySelector("#" + id);
  const showError = (error) => { const box = form.querySelector(".form-error"); box.textContent = error.message; box.hidden = false; };
  const clearError = () => (form.querySelector(".form-error").hidden = true);

  const readForm = () => {
    s.meta.name = $("pkgName").value.trim();
    s.meta.version = $("pkgVersion").value.trim();
    s.meta.description = $("pkgDescription").value.trim();
    if ($("pkgCategory")) s.meta.category = $("pkgCategory").value.trim();
    if ($("compName")) Object.assign(s.component, { name: $("compName").value.trim(), target: $("compTarget").value.trim(), language: $("compLanguage").value.trim() });
    if ($("skillName")) s.skill = slug($("skillName").value, "mi-skill");
  };
  const currentManifest = () => {
    readForm();
    if (s.manifestDirty) {
      let parsed;
      try { parsed = JSON.parse($("pkgManifest").value); } catch (error) { throw new Error("El manifiesto no es JSON válido: " + error.message); }
      return withIdentity(parsed, s.meta);
    }
    return buildManifest(s);
  };
  const syncManifest = () => {
    if (s.manifestDirty) { $("pkgManifest").value = s.manifestText || $("pkgManifest").value; s.manifestText = ""; return; }
    try { $("pkgManifest").value = JSON.stringify(currentManifest(), null, 2); clearError(); } catch (error) { showError(error); }
  };

  const loadStarter = () => {
    if (s.template === "existing") return;
    const untouched = [...s.files.keys()].every((path) => s.starter.has(path));
    if (!untouched) return;
    s.files.clear();
    s.starter = new Set();
    for (const [path, text] of Object.entries(TEMPLATES[s.template].starter(s))) { s.files.set(path, { bytes: textToBytes(text) }); s.starter.add(path); }
  };

  const drawTemplateFields = () => {
    const t = TEMPLATES[s.template];
    const category = html`<div class="field"><label for="pkgCategory">Categoría</label><input id="pkgCategory" pattern="[a-z][a-z0-9\\-]{0,63}" placeholder="${t?.category || "general"}" value="${s.meta.category}"><p class="hint">Informativa: backend, frontend, testing… Sirve para filtrar y para <code>modai list &lt;categoría&gt;</code>.</p></div>`;
    if (s.template === "component") {
      mount($("templateFields"), html`<div class="field-row">
          <div class="field"><label for="compName">Nombre del componente</label><input id="compName" required pattern="[a-z0-9][a-z0-9\\-]{0,63}" placeholder="auth" value="${s.component.name}"></div>
          <div class="field"><label for="compLanguage">Lenguaje o framework</label><input id="compLanguage" maxlength="64" placeholder="nestjs, express, react, python…" value="${s.component.language}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="compTarget">Destino en el proyecto</label><input id="compTarget" required placeholder="src/modules/{component}" value="${s.component.target}"><p class="hint">Carpeta donde <code>modai add</code> copia los archivos de <code>component/</code>. Admite {component} y {package}.</p></div>
          ${category}
        </div>`);
    } else if (s.template === "skill") {
      mount($("templateFields"), html`<div class="field-row"><div class="field"><label for="skillName">Nombre de la skill</label><input id="skillName" pattern="[a-z0-9][a-z0-9\\-]{0,63}" value="${s.skill}"><p class="hint">Cada carpeta <code>skills/&lt;nombre&gt;/</code> con un SKILL.md es una skill.</p></div>${category}</div>`);
    } else if (s.template === "existing") {
      mount($("templateFields"), "");
    } else {
      mount($("templateFields"), html`<div class="field-row">${category}</div>`);
    }
    const root = t?.root;
    $("uploadHint").textContent = s.template === "existing" ? "Edita, añade o elimina archivos; el manifiesto declara cuáles se instalan."
      : s.template === "component" ? "Sube la carpeta con tu código: se guarda en component/ y se instalará en el destino indicado."
      : s.template === "harness" ? "Los archivos de harness/ se instalan con la misma ruta en el proyecto (harness/AGENTS.md → AGENTS.md)."
      : root ? "Los archivos subidos se guardan en " + root + "/." : "Los archivos subidos se guardan en la raíz del paquete.";
  };

  const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const filesUnder = (dir) => [...s.files.keys()].filter((path) => path.startsWith(dir + "/"));
  const fileRow = (path) => {
    const text = bytesToText(s.files.get(path).bytes);
    return html`<tr>
      <td class="file-cell"><code>${path.slice(dirOf(path).length ? dirOf(path).length + 1 : 0)}</code>${text === null ? html` <span class="badge">binario</span>` : ""}</td>
      <td class="hide-sm">${formatBytes(s.files.get(path).bytes.length)}</td>
      <td class="actions">${text !== null ? html`<button type="button" class="btn small ghost" data-action="editFile" data-path="${path}">${icon("edit", 16)}Editar</button>` : ""}<button type="button" class="btn small ghost danger-text" data-action="removeFile" data-path="${path}" aria-label="Eliminar ${path}">${icon("trash", 16)}</button></td>
    </tr>`;
  };
  const folderRow = (dir) => {
    const count = filesUnder(dir).length;
    const editing = s.folderEdit?.dir === dir ? s.folderEdit.mode : null;
    return html`<tr class="folder-row" data-folder="${dir}"><td colspan="3"><div class="folder-head">
      ${icon("folder", 16)}<b><code>${dir}/</code></b><span class="muted small">${count} ${count === 1 ? "archivo" : "archivos"}</span>
      <span class="folder-actions">${editing === "rename"
        ? html`<label class="sr-only" for="folderName">Nuevo nombre de ${dir}</label><input id="folderName" class="mono" value="${dir}"><button type="button" class="btn small primary" data-action="renameFolderSave" data-dir="${dir}">Guardar nombre</button><button type="button" class="btn small ghost" data-action="folderCancel">Cancelar</button>`
        : editing === "delete"
          ? html`<span class="small">¿Eliminar ${count} ${count === 1 ? "archivo" : "archivos"}?</span><button type="button" class="btn small danger" data-action="deleteFolderConfirm" data-dir="${dir}">Eliminar carpeta</button><button type="button" class="btn small ghost" data-action="folderCancel">Cancelar</button>`
          : html`<button type="button" class="btn small ghost" data-action="renameFolder" data-dir="${dir}" aria-label="Renombrar la carpeta ${dir}">${icon("edit", 16)}Renombrar</button><button type="button" class="btn small ghost danger-text" data-action="deleteFolder" data-dir="${dir}" aria-label="Eliminar la carpeta ${dir}">${icon("trash", 16)}</button>`}</span>
    </div></td></tr>`;
  };

  const drawFiles = () => {
    const paths = [...s.files.keys()].sort();
    const total = paths.reduce((sum, path) => sum + s.files.get(path).bytes.length, 0);
    $("fileCount").textContent = paths.length;
    // Grouped by folder: each folder can be renamed or removed as a whole.
    const groups = new Map();
    for (const path of paths) groups.set(dirOf(path), [...(groups.get(dirOf(path)) || []), path]);
    const dirs = [...groups.keys()].sort((x, y) => x.localeCompare(y));
    mount($("fileList"), paths.length
      ? html`<div class="table-wrap"><table class="table file-table"><thead><tr><th scope="col">Ruta en el paquete</th><th scope="col" class="hide-sm">Tamaño</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${dirs.map((dir) => html`${dir ? folderRow(dir) : ""}${groups.get(dir).map(fileRow)}`)}</tbody></table></div><p class="hint">${formatBytes(total)} en total (máximo 25 MB).</p>`
      : html`<p class="muted small">Sin archivos todavía.</p>`);
    if (s.folderEdit?.mode === "rename") { const input = $("folderName"); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }
  };


  const drawEditor = () => {
    if (!s.editing) return mount($("fileEditor"), "");
    const root = TEMPLATES[s.template]?.root;
    mount($("fileEditor"), html`<div class="panel"><div class="panel-body stack">
      <div class="field"><label for="editPath">Ruta</label><input id="editPath" value="${s.editing.path ?? (root ? root + "/" : "")}" placeholder="${root ? root + "/" : ""}archivo.ts"></div>
      <div class="field"><label for="editContent">Contenido</label><textarea id="editContent" class="mono" rows="12" spellcheck="false">${s.editing.text ?? ""}</textarea></div>
      <div class="dialog-actions"><button type="button" class="btn small ghost" data-action="cancelFile">Cancelar</button><button type="button" class="btn small primary" data-action="saveFile">Guardar archivo</button></div>
    </div></div>`);
    const path = $("editPath");
    path.focus();
    path.setSelectionRange(path.value.length, path.value.length);
  };

  const refresh = () => { drawFiles(); drawEditor(); syncManifest(); };

  const addUploads = async (fileList, folder) => {
    const root = s.template === "existing" ? "" : TEMPLATES[s.template].root;
    let total = [...s.files.values()].reduce((sum, file) => sum + file.bytes.length, 0);
    let added = 0;
    for (const file of fileList) {
      let relative = folder ? file.webkitRelativePath.split("/").slice(1).join("/") : file.name;
      if (!relative || IGNORED.test(relative)) continue;
      if (s.template === "skill") relative = s.skill + "/" + relative;
      const path = cleanPath((root ? root + "/" : "") + relative);
      const bytes = new Uint8Array(await file.arrayBuffer());
      total += bytes.length - (s.files.get(path)?.bytes.length || 0);
      if (total > MAX_BYTES) throw new Error("El paquete superaría 25 MB; deja fuera dependencias y compilados.");
      s.files.set(path, { bytes });
      added++;
    }
    if (added && !folder && s.template === "component" && !s.component.name) $("compName").value = slug(fileList[0]?.name.replace(/\.[^.]+$/, ""), "component");
    if (added && folder && s.template === "component" && !$("compName").value) $("compName").value = slug(fileList[0]?.webkitRelativePath.split("/")[0], "component");
    toast(added + (added === 1 ? " archivo añadido" : " archivos añadidos"));
    refresh();
  };

  form.querySelectorAll('input[name="template"]').forEach((radio) => radio.addEventListener("change", () => {
    readForm();
    s.template = radio.value;
    if (!s.meta.category) s.meta.category = "";
    loadStarter();
    drawTemplateFields();
    refresh();
  }));
  form.addEventListener("input", (event) => {
    if (event.target.id === "pkgManifest") { s.manifestDirty = true; return; }
    if (["editPath", "editContent"].includes(event.target.id) || event.target.type === "file") return;
    if (event.target.id === "compName" || event.target.id === "skillName") {
      readForm();
      // Keep untouched starter files in sync with the component or skill name.
      if ([...s.files.keys()].every((path) => s.starter.has(path))) { loadStarter(); drawFiles(); }
    }
    syncManifest();
  });
  $("uploadFiles").addEventListener("change", (event) => addUploads(event.target.files, false).catch(showError).finally(() => (event.target.value = "")));
  $("uploadFolder").addEventListener("change", (event) => addUploads(event.target.files, true).catch(showError).finally(() => (event.target.value = "")));
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);

  delegate(form, {
    newFile: () => { s.editing = { path: null, text: "" }; drawEditor(); },
    editFile: (button) => { s.editing = { original: button.dataset.path, path: button.dataset.path, text: bytesToText(s.files.get(button.dataset.path).bytes) }; drawEditor(); },
    cancelFile: () => { s.editing = null; drawEditor(); },
    saveFile: () => {
      try {
        const path = cleanPath($("editPath").value);
        if (s.editing.original && s.editing.original !== path) s.files.delete(s.editing.original);
        s.files.set(path, { bytes: textToBytes($("editContent").value) });
        s.starter.delete(path);
        s.editing = null;
        clearError();
        refresh();
      } catch (error) { showError(error); }
    },
    removeFile: (button) => { s.files.delete(button.dataset.path); refresh(); },
    renameFolder: (button) => { s.folderEdit = { dir: button.dataset.dir, mode: "rename" }; drawFiles(); },
    deleteFolder: (button) => { s.folderEdit = { dir: button.dataset.dir, mode: "delete" }; drawFiles(); },
    folderCancel: () => { s.folderEdit = null; drawFiles(); },
    renameFolderSave: (button) => {
      try {
        const from = button.dataset.dir, to = cleanPath($("folderName").value);
        if (to !== from) {
          if (to.startsWith(from + "/")) throw new Error("Una carpeta no puede moverse dentro de sí misma.");
          const moves = filesUnder(from).map((path) => [path, to + path.slice(from.length)]);
          const clash = moves.find(([, next]) => s.files.has(next));
          if (clash) throw new Error("Ya existe " + clash[1] + "; elige otro nombre.");
          for (const [path, next] of moves) { s.files.set(next, s.files.get(path)); s.files.delete(path); s.starter.delete(path); }
        }
        s.folderEdit = null;
        clearError();
        refresh();
      } catch (error) { showError(error); }
    },
    deleteFolderConfirm: (button) => {
      for (const path of filesUnder(button.dataset.dir)) s.files.delete(path);
      s.folderEdit = null;
      refresh();
    },
    regenerate: () => { s.manifestDirty = false; syncManifest(); },
    validate: async (button) => {
      clearError();
      setBusy(button, true);
      try {
        const { quality } = await post("/packages/validate", { manifest: currentManifest(), files: await toArtifactFiles([...s.files].map(([path, file]) => ({ path, bytes: file.bytes }))) });
        mount($("validation"), qualityMarkup(quality));
      } catch (error) { showError(error); } finally { setBusy(button, false); }
    },
  });

  const submit = form.querySelector('button[type="submit"]');
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();
    if (!form.checkValidity()) { const invalid = form.querySelector(":invalid"); invalid?.focus(); return showError(new Error(invalid?.validationMessage || "Revisa el formulario.")); }
    setBusy(submit, true);
    try {
      const manifest = currentManifest();
      const { package: published } = await post("/packages", { manifest, files: await toArtifactFiles([...s.files].map(([path, file]) => ({ path, bytes: file.bytes }))) });
      store.invalidate("summary", "agents", "documents");
      // The shared <dialog> clears its body on the (async) close event: wait for it before another view reuses it.
      const dialog = document.getElementById("dialog");
      await new Promise((resolve) => { dialog.addEventListener("close", resolve, { once: true }); closeDialog(); });
      toast("Publicado " + published.name + "@" + published.version);
      await onPublished?.(published);
    } catch (error) {
      showError(error);
    } finally {
      if (document.contains(submit)) setBusy(submit, false);
    }
  });

  loadStarter();
  drawTemplateFields();
  refresh();
}
