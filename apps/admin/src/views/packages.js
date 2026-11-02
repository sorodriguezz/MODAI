import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { post, del } from "../lib/api.js";
import { openDialog, closeDialog, confirmDialog, promptDialog, toast, toastError, statusBadge, formatDate, timeTag, skeletonCards, emptyState, errorState, codeBlock, debounce, bindTabs } from "../lib/ui.js";
import { store, can, describeManifest, latestByName } from "../state.js";

const categoryIcons = { skill: "spark", agent: "bot", knowledge: "book", memory: "brain", mcp: "plug", tool: "tool", adapter: "layers", harness: "layers", profile: "user", template: "copy", methodology: "book" };
const permissionLabels = {
  "project.instructions": "Escribir instrucciones del agente",
  "project.files": "Instalar archivos en docs/",
  "process.execute": "Ejecutar comandos",
  "mcp.connect": "Iniciar servidores MCP",
  "filesystem.read": "Leer archivos del proyecto",
  "filesystem.write": "Escribir archivos del proyecto",
  network: "Usar la red",
  "env.read": "Leer variables de entorno",
};

const filters = { q: "", category: "", format: "", status: "latest" };

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
      <span>v${item.version}</span>
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
    ${codeBlock("installCommand", "modai add " + item.name + "@" + item.version, "Copiar")}
    <dl class="definition-grid">
      <div><dt>Formato</dt><dd>${info.format === "v1" ? html`<code>${info.apiVersion}</code>` : "Manifiesto legado (schemaVersion 1)"}</dd></div>
      ${info.kind ? html`<div><dt>Tipo (kind)</dt><dd>${info.kind}</dd></div>` : ""}
      <div><dt>Categoría</dt><dd>${info.category}</dd></div>
      <div><dt>Publicado</dt><dd>${formatDate(item.publishedAt)}</dd></div>
      <div><dt>Firma</dt><dd>${item.signerFingerprint ? html`<code title="${item.signerFingerprint}">${item.signerFingerprint.slice(0, 16)}…</code> ${item.publisherTrusted ? html`<span class="badge tone-success">De confianza</span>` : html`<span class="badge">No verificado</span>`}` : html`<span class="muted">Sin firma</span>`}</dd></div>
      <div><dt>Calidad estructural</dt><dd>${item.quality ? item.quality.score + "/100" : html`<span class="muted">Sin evaluar</span>`}</dd></div>
      ${info.license ? html`<div><dt>Licencia</dt><dd>${info.license}</dd></div>` : ""}
      ${info.authors?.length ? html`<div><dt>Autoría</dt><dd>${info.authors.join(", ")}</dd></div>` : ""}
    </dl>
    ${info.format === "v1" ? html`
      <h4>Provee</h4>${capabilityList(info.provides, "No declara capacidades provistas.")}
      <h4>Requiere</h4>${capabilityList(info.requires, "No requiere otras capacidades.")}
      ${info.optional.length ? html`<h4>Opcionales</h4>${capabilityList(info.optional, "")}` : ""}` : ""}
    <h4>Permisos solicitados</h4>
    ${info.permissions.length ? html`<ul class="chip-list">${info.permissions.map((permission) => html`<li class="chip warn" title="${permission}">${icon("shield", 14)}${permissionLabels[permission] || permission}</li>`)}</ul>` : html`<p class="muted small">No solicita permisos especiales.</p>`}
    <h4>Contribuciones</h4>${contributionsSummary(info)}
    <h4>Dependencias</h4>
    ${deps.length ? html`<ul class="chip-list">${deps.map(([name, range]) => html`<li class="chip"><code>${name}</code><span class="muted">${range}</span></li>`)}</ul>` : html`<p class="muted small">Sin dependencias.</p>`}`;
}

function versionsPanel(versions) {
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Versión</th><th scope="col">Estado</th><th scope="col" class="hide-sm">Publicada</th>${can.admin() ? html`<th scope="col"><span class="sr-only">Acciones</span></th>` : ""}</tr></thead>
    <tbody>${versions.map((item) => html`<tr>
      <td><b>${item.version}</b>${item.deprecatedMessage ? html`<div class="muted small">${item.deprecatedMessage}</div>` : ""}</td>
      <td>${statusBadge(item.status)}</td>
      <td class="hide-sm">${timeTag(item.publishedAt)}</td>
      ${can.admin() ? html`<td class="actions">
        ${item.status === "active" ? html`<button class="btn small ghost" data-action="deprecate" data-version="${item.version}">Deprecar</button>` : ""}
        ${item.status !== "yanked" ? html`<button class="btn small ghost danger-text" data-action="yank" data-version="${item.version}">Retirar</button>` : html`<button class="btn small ghost danger-text" data-action="hardDelete" data-version="${item.version}">${icon("trash", 16)}Eliminar</button>`}
      </td>` : ""}
    </tr>`)}</tbody></table></div>
    ${can.admin() ? html`<p class="hint">Deprecar avisa a quien instale la versión. Retirar (yank) impide nuevas resoluciones. Solo una versión retirada puede eliminarse definitivamente.</p>` : ""}`;
}

function qualityPanel(item) {
  if (!item.quality) return html`<p class="muted">Esta versión no tiene evaluación estructural.</p>`;
  const tone = { error: "danger", warning: "warning", info: "info" };
  return html`<div class="quality-score"><strong>${item.quality.score}</strong><span>/100</span></div>
    <p class="hint">Evalúa la estructura del paquete; no sustituye pruebas funcionales.</p>
    ${Object.keys(item.quality.dimensions || {}).length ? html`<dl class="definition-grid">${Object.entries(item.quality.dimensions).map(([key, value]) => html`<div><dt>${key}</dt><dd>${value}</dd></div>`)}</dl>` : ""}
    ${item.quality.findings?.length ? html`<ul class="findings">${item.quality.findings.map((finding) => html`<li class="tone-${tone[finding.severity] || "info"}">${icon(finding.severity === "info" ? "info" : "alert", 16)}<span><code>${finding.code}</code> ${finding.message}</span></li>`)}</ul>` : html`<p class="muted small">Sin observaciones.</p>`}`;
}

export function openPackage(all, name, version, onChange) {
  const versions = all.filter((item) => item.name === name).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
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
        <button role="tab" type="button" data-tab="quality" aria-selected="false" tabindex="-1">Calidad</button>
        <button role="tab" type="button" data-tab="manifest" aria-selected="false" tabindex="-1">Manifiesto</button>
      </div>
      <div role="tabpanel" data-panel="overview" class="tab-panel">${overviewPanel(item, info)}</div>
      <div role="tabpanel" data-panel="versions" class="tab-panel" hidden>${versionsPanel(versions)}</div>
      <div role="tabpanel" data-panel="quality" class="tab-panel" hidden>${qualityPanel(item)}</div>
      <div role="tabpanel" data-panel="manifest" class="tab-panel" hidden>${codeBlock("manifestJson", JSON.stringify(item.manifest, null, 2), "Copiar JSON")}</div>`,
  });
  bindTabs(body);
  const changed = async (message) => {
    toast(message);
    closeDialog();
    await onChange?.();
  };
  delegate(body, {
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

export default {
  id: "packages",
  label: "Paquetes",
  icon: "package",
  title: "Paquetes",
  subtitle: "Skills, herramientas, conocimiento y agentes publicados en este servidor.",
  async render(root, { params, navigate, isCurrent }) {
    mount(root, html`
      <div class="toolbar">
        <div class="search-field">${icon("search")}<label class="sr-only" for="packageSearch">Buscar paquetes</label><input id="packageSearch" type="search" placeholder="Buscar por nombre, descripción o capacidad…" value="${filters.q}"></div>
        <label class="sr-only" for="packageCategory">Categoría</label><select id="packageCategory"><option value="">Todas las categorías</option></select>
        <label class="sr-only" for="packageFormat">Formato</label><select id="packageFormat"><option value="">Todos los formatos</option><option value="v1">modai.dev/v1</option><option value="legacy">Legado</option></select>
        <label class="sr-only" for="packageStatus">Estado</label><select id="packageStatus"><option value="latest">Última versión activa</option><option value="all">Todas las versiones</option><option value="deprecated">Deprecadas</option><option value="yanked">Retiradas</option></select>
      </div>
      <p class="results-meta" id="packageMeta" aria-live="polite"></p>
      <div id="packageResults">${skeletonCards()}</div>`);
    const $q = root.querySelector("#packageSearch"), $category = root.querySelector("#packageCategory"), $format = root.querySelector("#packageFormat"), $status = root.querySelector("#packageStatus");
    $format.value = filters.format;
    $status.value = filters.status;
    let all = [];
    const draw = () => {
      filters.q = $q.value.trim();
      filters.category = $category.value;
      filters.format = $format.value;
      filters.status = $status.value;
      const q = filters.q.toLocaleLowerCase();
      let list = filters.status === "latest" ? latestByName(all) : filters.status === "all" ? all : all.filter((item) => item.status === filters.status);
      list = list.filter((item) => {
        const info = describeManifest(item);
        if (filters.category && info.category !== filters.category) return false;
        if (filters.format && info.format !== filters.format) return false;
        if (!q) return true;
        return [item.name, item.description, info.category, ...info.provides.map((p) => p.capability), ...(info.keywords || [])].join(" ").toLocaleLowerCase().includes(q);
      }).sort((a, b) => a.name.localeCompare(b.name) || new Date(b.publishedAt) - new Date(a.publishedAt));
      root.querySelector("#packageMeta").textContent = list.length + (list.length === 1 ? " paquete" : " paquetes") + (filters.status === "latest" ? " · última versión activa de cada uno" : "");
      mount(root.querySelector("#packageResults"), list.length
        ? html`<div class="card-grid">${list.map(card)}</div>`
        : all.length
          ? emptyState({ iconName: "search", title: "Sin resultados", text: "Prueba con otra búsqueda o cambia los filtros.", action: html`<button class="btn" data-action="clear">Limpiar filtros</button>` })
          : emptyState({ iconName: "package", title: "Aún no hay paquetes", text: "Publica capacidades con la CLI: modai publish ./mi-paquete" }));
    };
    const load = async (force = false) => {
      try {
        all = await store.packages(force);
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#packageResults"), errorState(error));
        return;
      }
      if (!isCurrent()) return;
      const categories = [...new Set(all.map((item) => describeManifest(item).category))].sort();
      mount($category, html`<option value="">Todas las categorías</option>${categories.map((category) => html`<option value="${category}">${category}</option>`)}`);
      $category.value = categories.includes(filters.category) ? filters.category : "";
      draw();
    };
    $q.addEventListener("input", debounce(draw));
    [$category, $format, $status].forEach((select) => select.addEventListener("change", draw));
    delegate(root, {
      open: (button) => openPackage(all, button.dataset.name, button.dataset.version, () => load(true)),
      clear: () => {
        $q.value = "";
        $category.value = "";
        $format.value = "";
        $status.value = "latest";
        draw();
      },
      retry: () => load(true),
    });
    await load();
    const requested = params.get("name");
    if (requested && isCurrent() && all.some((item) => item.name === requested)) openPackage(all, requested, params.get("version"), () => load(true));
  },
};
