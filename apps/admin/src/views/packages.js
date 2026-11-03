import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post, del } from "../lib/api.js";
import { base64ToBytes, bytesToText, formatBytes } from "../lib/files.js";
import { openPackageEditor } from "./package-editor.js";
import { openDialog, closeDialog, confirmDialog, promptDialog, toast, toastError, statusBadge, formatDate, timeTag, skeletonCards, emptyState, errorState, codeBlock, debounce, bindTabs } from "../lib/ui.js";
import { store, can, describeManifest } from "../state.js";

const categoryIcons = { component: "code", skill: "spark", agent: "bot", knowledge: "book", memory: "brain", mcp: "plug", tool: "tool", adapter: "layers", harness: "layers", profile: "user", template: "copy", methodology: "book" };
const permissionLabels = {
  "project.instructions": "Escribir instrucciones del agente",
  "project.files": "Instalar archivos en docs/",
  "project.source": "Instalar código fuente en el proyecto",
  "process.execute": "Ejecutar comandos",
  "mcp.connect": "Iniciar servidores MCP",
  "filesystem.read": "Leer archivos del proyecto",
  "filesystem.write": "Escribir archivos del proyecto",
  network: "Usar la red",
  "env.read": "Leer variables de entorno",
};

const filters = { q: "", type: "", category: "", status: "latest" };

/** "What is it?" filter: contributions and kinds, independent of the free-form category. */
const TYPES = {
  components: { label: "Componentes de código", test: (info) => info.contributes.components.length > 0 || info.category === "component" },
  harness: { label: "Harnesses", test: (info) => info.category === "harness" },
  skills: { label: "Skills", test: (info) => info.contributes.skills.length > 0 },
  tools: { label: "Herramientas y MCP", test: (info) => info.contributes.tools.length + info.contributes.mcpServers.length > 0 },
  agents: { label: "Agentes", test: (info) => info.contributes.agents.length > 0 },
  knowledge: { label: "Conocimiento", test: (info) => info.contributes.knowledge.length > 0 },
  profiles: { label: "Perfiles", test: (info) => info.kind === "Profile" || info.category === "profile" },
  adapters: { label: "Adaptadores", test: (info) => info.kind === "Adapter" || info.category === "adapter" },
};
const INSTALL_PERMISSIONS = ["project.instructions", "project.files", "project.source"];

function installCommand(item, info) {
  const allow = info.permissions.filter((permission) => INSTALL_PERMISSIONS.includes(permission));
  return "modai add " + item.name + "@" + item.version + (allow.length ? " --allow " + allow.join(",") : "");
}

function capabilityList(items, emptyText) {
  return items.length
    ? html`<ul class="chip-list">${items.map((item) => html`<li class="chip" title="${item.description || ""}"><code>${item.capability}</code><span class="muted">${item.version}</span></li>`)}</ul>`
    : html`<p class="muted small">${emptyText}</p>`;
}

function card(item) {
  const info = describeManifest(item);
  return html`<button type="button" class="card package-card" data-action="open" data-name="${item.name}" data-version="${item.version}">
    <span class="card-top"><span class="card-icon">${icon(categoryIcons[info.category] || "package")}</span>
      <span class="card-badges"><span class="badge">${info.category}</span>${info.kind && info.kind !== "Package" ? html`<span class="badge tone-info">${info.kind}</span>` : ""}${item.status !== "active" ? statusBadge(item.status) : ""}</span></span>
    <span class="card-title">${item.name}</span>
    <span class="card-text">${item.description}</span>
    <span class="card-meta">
      <span>v${item.version}${item.versions > 1 ? html` <span class="muted" title="Versiones publicadas">· ${item.versions} versiones</span>` : ""}</span>
      ${info.provides.length ? html`<span title="Capacidades que provee">${icon("spark", 14)}${info.provides.length}</span>` : ""}
      ${item.quality ? html`<span class="${item.quality.score >= 80 ? "text-success" : item.quality.score < 50 ? "text-warning" : ""}" title="Calidad estructural">${item.quality.score}/100</span>` : ""}
      ${item.signerFingerprint ? html`<span title="Firmado">${icon("shield", 14)}${item.publisherTrusted ? "Confiable" : "Firmado"}</span>` : ""}
    </span>
  </button>`;
}

function contributionsSummary(info) {
  const c = info.contributes;
  const rows = [
    ["Skills", c.skills.map((item) => item.name)],
    ["Reglas", c.rules.map((item) => item.name)],
    ["Conocimiento", c.knowledge.map((item) => item.title || item.path || item.source)],
    ["Herramientas", c.tools.map((item) => item.name)],
    ["Servidores MCP", c.mcpServers.map((item) => item.name)],
    ["Agentes", c.agents.map((item) => item.name)],
    ["Componentes", c.components.map((item) => item.name + " → " + item.target)],
    ["Archivos", c.files.map((item) => item.target)],
  ].filter(([, list]) => list.length);
  return rows.length
    ? html`<dl class="definition-grid">${rows.map(([label, list]) => html`<div><dt>${label} <span class="count">${list.length}</span></dt><dd>${list.slice(0, 8).join(", ")}${list.length > 8 ? ` y ${list.length - 8} más` : ""}</dd></div>`)}</dl>`
    : html`<p class="muted small">Este paquete no declara contribuciones.</p>`;
}

function overviewPanel(item, info) {
  const deps = Object.entries(info.dependencies || {});
  return html`
    <p class="lead">${info.description}</p>
    ${item.deprecatedMessage ? html`<div class="callout tone-${item.status === "yanked" ? "danger" : "warning"}">${icon("alert")}<span><b>${item.status === "yanked" ? "Versión retirada" : "Versión deprecada"}:</b> ${item.deprecatedMessage}</span></div>` : ""}
    ${codeBlock("installCommand", installCommand(item, info), "Copiar")}
    ${info.contributes.components.length ? html`<p class="hint">Los componentes se copian al proyecto. Quien los instale puede modificarlos: <code>modai remove</code> conserva los archivos editados.</p>` : ""}
    <dl class="definition-grid">
      <div><dt>Formato</dt><dd><code>${info.apiVersion}</code></dd></div>
      ${info.kind ? html`<div><dt>Tipo (kind)</dt><dd>${info.kind}</dd></div>` : ""}
      <div><dt>Categoría</dt><dd>${info.category}</dd></div>
      <div><dt>Publicado</dt><dd>${formatDate(item.publishedAt)}</dd></div>
      <div><dt>Firma</dt><dd>${item.signerFingerprint ? html`<code title="${item.signerFingerprint}">${item.signerFingerprint.slice(0, 16)}…</code> ${item.publisherTrusted ? html`<span class="badge tone-success">De confianza</span>` : html`<span class="badge">No verificado</span>`}` : html`<span class="muted">Sin firma</span>`}</dd></div>
      <div><dt>Calidad estructural</dt><dd>${item.quality ? item.quality.score + "/100" : html`<span class="muted">Sin evaluar</span>`}</dd></div>
      ${info.license ? html`<div><dt>Licencia</dt><dd>${info.license}</dd></div>` : ""}
      ${info.authors?.length ? html`<div><dt>Autoría</dt><dd>${info.authors.join(", ")}</dd></div>` : ""}
    </dl>
    <h4>Provee</h4>${capabilityList(info.provides, "No declara capacidades provistas.")}
    <h4>Requiere</h4>${capabilityList(info.requires, "No requiere otras capacidades.")}
    ${info.optional.length ? html`<h4>Opcionales</h4>${capabilityList(info.optional, "")}` : ""}
    <h4>Permisos solicitados</h4>
    ${info.permissions.length ? html`<ul class="chip-list">${info.permissions.map((permission) => html`<li class="chip warn" title="${permission}">${icon("shield", 14)}${permissionLabels[permission] || permission}</li>`)}</ul>` : html`<p class="muted small">No solicita permisos especiales.</p>`}
    <h4>Contribuciones</h4>${contributionsSummary(info)}
    <h4>Dependencias</h4>
    ${deps.length ? html`<ul class="chip-list">${deps.map(([name, range]) => html`<li class="chip"><code>${name}</code><span class="muted">${range}</span></li>`)}</ul>` : html`<p class="muted small">Sin dependencias.</p>`}`;
}

function versionsPanel(versions) {
  const manage = can.managePackages(versions[0]?.name);
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Versión</th><th scope="col">Estado</th><th scope="col" class="hide-sm">Publicada</th>${manage ? html`<th scope="col"><span class="sr-only">Acciones</span></th>` : ""}</tr></thead>
    <tbody>${versions.map((item) => html`<tr>
      <td><b>${item.version}</b>${item.deprecatedMessage ? html`<div class="muted small">${item.deprecatedMessage}</div>` : ""}</td>
      <td>${statusBadge(item.status)}</td>
      <td class="hide-sm">${timeTag(item.publishedAt)}</td>
      ${manage ? html`<td class="actions">
        ${item.status === "active" ? html`<button class="btn small ghost" data-action="deprecate" data-version="${item.version}">Deprecar</button>` : ""}
        ${item.status !== "yanked" ? html`<button class="btn small ghost danger-text" data-action="yank" data-version="${item.version}">Retirar</button>` : can.deletePackages() ? html`<button class="btn small ghost danger-text" data-action="hardDelete" data-version="${item.version}">${icon("trash", 16)}Eliminar</button>` : ""}
      </td>` : ""}
    </tr>`)}</tbody></table></div>
    ${manage ? html`<p class="hint">Deprecar avisa a quien instale la versión. Retirar (yank) impide nuevas resoluciones. Solo una versión retirada puede eliminarse definitivamente.</p>` : ""}`;
}

function qualityPanel(item) {
  if (!item.quality) return html`<p class="muted">Esta versión no tiene evaluación estructural.</p>`;
  const tone = { error: "danger", warning: "warning", info: "info" };
  return html`<div class="quality-score"><strong>${item.quality.score}</strong><span>/100</span></div>
    <p class="hint">Evalúa la estructura del paquete; no sustituye pruebas funcionales.</p>
    ${Object.keys(item.quality.dimensions || {}).length ? html`<dl class="definition-grid">${Object.entries(item.quality.dimensions).map(([key, value]) => html`<div><dt>${key}</dt><dd>${value}</dd></div>`)}</dl>` : ""}
    ${item.quality.findings?.length ? html`<ul class="findings">${item.quality.findings.map((finding) => html`<li class="tone-${tone[finding.severity] || "info"}">${icon(finding.severity === "info" ? "info" : "alert", 16)}<span><code>${finding.code}</code> ${finding.message}</span></li>`)}</ul>` : html`<p class="muted small">Sin observaciones.</p>`}`;
}

export async function openPackage(name, version, onChange, onPublished = onChange) {
  let versions;
  try {
    versions = (await get("/packages?includeYanked=true&name=" + encodeURIComponent(name))).packages.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  } catch (error) {
    return toastError(error);
  }
  const item = versions.find((entry) => entry.version === version) || versions[0];
  if (!item) return toastError(new Error("El paquete ya no existe."));
  const info = describeManifest(item);
  const body = openDialog({
    title: item.name,
    description: "Versión " + item.version + " · " + info.category + (info.kind ? " · " + info.kind : ""),
    size: "lg",
    body: html`<div class="tabs" role="tablist" aria-label="Detalle del paquete">
        <button role="tab" type="button" data-tab="overview" aria-selected="true">Resumen</button>
        <button role="tab" type="button" data-tab="versions" aria-selected="false" tabindex="-1">Versiones <span class="count">${versions.length}</span></button>
        <button role="tab" type="button" data-tab="files" aria-selected="false" tabindex="-1">Archivos</button>
        <button role="tab" type="button" data-tab="usage" aria-selected="false" tabindex="-1">Proyectos</button>
        <button role="tab" type="button" data-tab="quality" aria-selected="false" tabindex="-1">Calidad</button>
        <button role="tab" type="button" data-tab="manifest" aria-selected="false" tabindex="-1">Manifiesto</button>
      </div>
      <div role="tabpanel" data-panel="overview" class="tab-panel">${overviewPanel(item, info)}</div>
      <div role="tabpanel" data-panel="versions" class="tab-panel" hidden>${versionsPanel(versions)}</div>
      <div role="tabpanel" data-panel="files" class="tab-panel" hidden><div id="packageFiles">${html`<p class="muted small">Cargando archivos…</p>`}</div></div>
      <div role="tabpanel" data-panel="usage" class="tab-panel" hidden><div id="packageUsage">${html`<p class="muted small">Cargando proyectos…</p>`}</div></div>
      <div role="tabpanel" data-panel="quality" class="tab-panel" hidden>${qualityPanel(item)}</div>
      ${can.publish() ? html`<div class="dialog-actions"><button type="button" class="btn" data-action="newVersion">${icon("edit")}Editar y publicar nueva versión</button></div>` : ""}
      <div role="tabpanel" data-panel="manifest" class="tab-panel" hidden>${codeBlock("manifestJson", JSON.stringify(item.manifest, null, 2), "Copiar JSON")}</div>`,
  });
  let files = null, usageLoaded = false;
  bindTabs(body, async (tab) => {
    if (tab === "usage" && !usageLoaded) {
      usageLoaded = true;
      try {
        const { projects } = await get("/packages/usage?name=" + encodeURIComponent(name));
        mount(body.querySelector("#packageUsage"), projects.length
          ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Proyecto</th><th scope="col">Versión</th><th scope="col" class="hide-sm">Cómo</th><th scope="col" class="hide-sm">Reportado</th></tr></thead>
            <tbody>${projects.map((project) => html`<tr><td><b>${project.projectName}</b><div class="muted small"><code>${project.projectId}</code></div></td>
              <td>${project.version}${versions[0] && project.version !== versions[0].version ? html` <span class="badge tone-warning" title="Hay una versión más nueva">desactualizado</span>` : ""}</td>
              <td class="hide-sm">${project.direct ? "Directa" : "Dependencia"}</td><td class="hide-sm">${timeTag(project.reportedAt)}</td></tr>`)}</tbody></table></div>
            <p class="hint">Cada proyecto vinculado a este servidor (modai init --project) informa lo que instala al sincronizar. Solo ves los proyectos a los que tienes acceso.</p>`
          : emptyState({ iconName: "folder", title: "Ningún proyecto lo usa", text: "O los proyectos que lo instalan no están vinculados a este servidor con modai init --project." }));
      } catch (error) {
        mount(body.querySelector("#packageUsage"), errorState(error));
      }
      return;
    }
    if (tab !== "files" || files) return;
    try {
      files = (await get("/artifacts/" + encodeURIComponent(item.artifactId))).files;
      mount(body.querySelector("#packageFiles"), files.length
        ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Archivo</th><th scope="col" class="hide-sm">Tamaño</th></tr></thead>
          <tbody>${files.map((file) => html`<tr><td><button type="button" class="link-button" data-action="showFile" data-path="${file.path}"><code>${file.path}</code></button></td><td class="hide-sm">${formatBytes(base64ToBytes(file.content).length)}</td></tr>`)}</tbody></table></div>
          <div id="fileViewer"></div>`
        : html`<p class="muted small">El paquete no contiene archivos.</p>`);
    } catch (error) {
      mount(body.querySelector("#packageFiles"), errorState(error));
    }
  });
  const changed = async (message) => {
    toast(message);
    closeDialog();
    await onChange?.();
  };
  delegate(body, {
    showFile: (button) => {
      const file = files?.find((entry) => entry.path === button.dataset.path);
      if (!file) return;
      const text = bytesToText(base64ToBytes(file.content));
      mount(body.querySelector("#fileViewer"), html`<h4><code>${file.path}</code></h4>${text === null ? html`<p class="muted small">Archivo binario.</p>` : html`<pre class="pre-wrap document">${text}</pre>`}`);
      body.querySelector("#fileViewer").scrollIntoView({ block: "nearest" });
    },
    newVersion: () => openPackageEditor({ base: item, onPublished }),
    deprecate: (button) => promptDialog({
      title: "Deprecar " + name + "@" + button.dataset.version,
      message: "La versión seguirá instalable, pero la CLI mostrará este aviso.",
      label: "Mensaje para quien la use",
      placeholder: "Usa la versión 2.x, que corrige…",
      confirmLabel: "Deprecar versión",
      action: (message) => post("/admin/packages/deprecate", { name, version: button.dataset.version, message }),
    }).then((value) => value !== null && changed("Versión deprecada")),
    yank: (button) => promptDialog({
      title: "Retirar " + name + "@" + button.dataset.version,
      message: "Una versión retirada deja de resolverse para instalaciones nuevas. Los proyectos que ya la fijaron conservan su copia.",
      label: "Motivo",
      placeholder: "Vulnerabilidad, publicación errónea…",
      confirmLabel: "Retirar versión",
      danger: true,
      action: (reason) => post("/admin/packages/yank", { name, version: button.dataset.version, reason }),
    }).then((value) => value !== null && changed("Versión retirada")),
    hardDelete: (button) => {
      const spec = name + "@" + button.dataset.version;
      confirmDialog({
        title: "Eliminar definitivamente",
        message: "Se borrarán la versión, su artefacto y su conocimiento asociado. Esta acción no se puede deshacer.",
        typed: spec,
        confirmLabel: "Eliminar para siempre",
        action: () => del("/admin/packages", { name, version: button.dataset.version, confirmation: spec }),
      }).then((ok) => ok && changed("Versión eliminada"));
    },
  });
}

const PAGE_SIZE = 24;

function pager(page, pages) {
  if (pages <= 1) return "";
  return html`<nav class="pager" aria-label="Páginas del catálogo">
    <button type="button" class="btn small" data-action="page" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>Anterior</button>
    <span class="muted small" aria-current="page">Página ${page} de ${pages}</span>
    <button type="button" class="btn small" data-action="page" data-page="${page + 1}" ${page >= pages ? "disabled" : ""}>Siguiente</button>
  </nav>`;
}

export default {
  id: "packages",
  label: "Paquetes",
  icon: "package",
  title: "Paquetes",
  subtitle: "Componentes de código, harnesses, skills, herramientas, conocimiento y agentes publicados en este servidor.",
  async render(root, { params, isCurrent, actions }) {
    if (can.publish()) mount(actions, html`<button class="btn primary" data-action="create">${icon("plus")}Crear paquete</button>`);
    mount(root, html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="packageSearch">Buscar paquetes</label><input id="packageSearch" type="search" placeholder="Buscar por nombre, descripción o capacidad…" value="${filters.q}"></div>
        <label class="sr-only" for="packageType">Tipo</label><select id="packageType"><option value="">Todos los tipos</option>${Object.entries(TYPES).map(([id, type]) => html`<option value="${id}">${type.label}</option>`)}</select>
        <label class="sr-only" for="packageCategory">Categoría</label><select id="packageCategory"><option value="">Todas las categorías</option></select>
        <label class="sr-only" for="packageStatus">Estado</label><select id="packageStatus"><option value="latest">Última versión activa</option><option value="all">Todas las versiones</option><option value="deprecated">Deprecadas</option><option value="yanked">Retiradas</option></select>
      </div>
      <p class="results-meta" id="packageMeta" aria-live="polite"></p>
      <div id="packageResults">${skeletonCards()}</div>`);
    const $type = root.querySelector("#packageType");
    $type.value = filters.type;
    const $q = root.querySelector("#packageSearch"), $category = root.querySelector("#packageCategory"), $status = root.querySelector("#packageStatus");
    $status.value = filters.status;
    let page = 1, request = 0, items = [], total = 0;
    // The server filters and paginates: the browser only receives the page it shows.
    const load = async () => {
      filters.q = $q.value.trim();
      filters.category = $category.value;
      filters.type = $type.value;
      filters.status = $status.value;
      const token = ++request;
      const query = new URLSearchParams({ status: filters.status, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
      for (const key of ["q", "type", "category"]) if (filters[key]) query.set(key, filters[key]);
      let result;
      try {
        result = await get("/packages/catalog?" + query);
      } catch (error) {
        if (isCurrent() && token === request) mount(root.querySelector("#packageResults"), errorState(error));
        return;
      }
      if (!isCurrent() || token !== request) return;
      ({ items, total } = result);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (page > pages) { page = pages; return load(); }
      const selected = $category.value;
      mount($category, html`<option value="">Todas las categorías</option>${result.categories.map((category) => html`<option value="${category}">${category}</option>`)}`);
      $category.value = result.categories.includes(selected) ? selected : "";
      const filtered = Boolean(filters.q || filters.type || filters.category || filters.status !== "latest");
      root.querySelector("#packageMeta").textContent = total + (total === 1 ? " paquete" : " paquetes") + (filters.status === "latest" ? " · última versión activa de cada uno" : "");
      mount(root.querySelector("#packageResults"), items.length
        ? html`<div class="card-grid">${items.map(card)}</div>${pager(page, pages)}`
        : filtered
          ? emptyState({ iconName: "search", title: "Sin resultados", text: "Prueba con otra búsqueda o cambia los filtros.", action: html`<button class="btn" data-action="clear">Limpiar filtros</button>` })
          : emptyState({ iconName: "package", title: "Aún no hay paquetes", text: "Publica capacidades con la CLI (modai package publish ./mi-paquete) o créalas aquí: componentes de código, harnesses, skills y conocimiento.", action: can.publish() ? html`<button class="btn primary" data-action="create">${icon("plus")}Crear paquete</button>` : "" }));
    };
    const reload = () => { page = 1; return load(); };
    $q.addEventListener("input", debounce(reload, 250));
    [$type, $category, $status].forEach((select) => select.addEventListener("change", reload));
    const published = async (record) => {
      store.invalidate("summary", "agents");
      await load();
      if (isCurrent()) openPackage(record.name, record.version, load, published);
    };
    const create = () => openPackageEditor({ template: filters.type === "harness" ? "harness" : filters.type === "skills" ? "skill" : filters.type === "knowledge" ? "knowledge" : "component", onPublished: published });
    delegate(actions, { create });
    delegate(root, {
      create,
      open: (button) => openPackage(button.dataset.name, button.dataset.version, load, published),
      page: (button) => { page = Number(button.dataset.page); load().then(() => root.querySelector("#packageResults")?.scrollIntoView({ block: "start" })); },
      clear: () => {
        $q.value = "";
        $type.value = "";
        $category.value = "";
        $status.value = "latest";
        reload();
      },
      retry: load,
    });
    await load();
    const requested = params.get("name");
    if (requested && isCurrent()) openPackage(requested, params.get("version"), load, published);
  },
};
