import { state } from "../state.js";
import { $, esc, modal, date } from "../lib/ui.js";
import { icon } from "../lib/icons.js";

export function renderPackages() {
  const q = $("packageSearch").value.toLocaleLowerCase(),
    type = $("typeFilter").value,
    status = $("statusFilter").value;
  let list = state.packages.filter(
    (p) =>
      (!type || p.type === type) &&
      (!q || (p.name + " " + p.description).toLocaleLowerCase().includes(q)),
  );
  if (status === "latest") {
    const map = new Map();
    list
      .filter((p) => p.status === "active")
      .forEach((p) => {
        const a = map.get(p.name);
        if (!a || new Date(p.publishedAt) > new Date(a.publishedAt))
          map.set(p.name, p);
      });
    list = [...map.values()];
  } else if (status !== "all") list = list.filter((p) => p.status === status);
  $("resultsMeta").textContent =
    list.length +
    " resultados" +
    (status === "latest" ? " · Una versión activa por paquete" : "");
  $("packageCards").innerHTML = list.length
    ? list
        .map(
          (p) =>
            '<button class="package-card" data-package="' +
            esc(p.name) +
            '" data-version="' +
            esc(p.version) +
            '"><div class="package-top"><span class="package-icon">' +
            icon(
              p.type === "skill"
                ? "spark"
                : p.type === "knowledge"
                  ? "book"
                  : p.type === "memory"
                    ? "memory"
                    : "grid",
            ) +
            '</span><span class="badge ' +
            esc(p.type) +
            '">' +
            esc(p.type) +
            "</span></div><h3>" +
            esc(p.name) +
            "</h3><p>" +
            esc(p.description) +
            '</p><div class="package-bottom"><span>v' +
            esc(p.version) +
            (p.status !== "active" ? " · " + esc(p.status) : "") +
            '</span><span class="' +
            (p.quality?.score >= 80 ? "green" : "") +
            '">' +
            (p.quality ? "● " + p.quality.score + "/100" : "Sin evaluar") +
            "</span><span>Ver detalle ↗</span></div></button>",
        )
        .join("")
    : '<div class="panel empty" style="grid-column:1/-1"><h3>' +
      (state.session ? "No encontramos paquetes" : "Conecta tu biblioteca") +
      "</h3><p>" +
      (state.session
        ? "Prueba con otra búsqueda o cambia los filtros."
        : "Abre Conexión para acceder al servidor.") +
      "</p></div>";
  $("packageCards")
    .querySelectorAll("[data-package]")
    .forEach(
      (e) =>
        (e.onclick = () => packageDetail(e.dataset.package, e.dataset.version)),
    );
}
export function packageDetail(name, version) {
  const p = state.packages.find(
    (p) => p.name === name && p.version === version,
  );
  if (!p) return;
  modal(
    p.name,
    '<span class="badge ' +
      esc(p.type) +
      '">' +
      esc(p.type) +
      '</span> <span class="badge ' +
      esc(p.status) +
      '">' +
      esc(p.status) +
      "</span><p>" +
      esc(p.description) +
      '</p><div class="copy-line"><code id="installCommand">modai add ' +
      esc(p.name) +
      "@" +
      esc(p.version) +
      '</code><button class="btn" data-copy="installCommand">Copiar</button></div><div class="details-grid"><div><div class="detail-label">Versión</div><div class="detail-value">' +
      esc(p.version) +
      '</div></div><div><div class="detail-label">Publicado</div><div class="detail-value">' +
      date(p.publishedAt) +
      '</div></div><div><div class="detail-label">Calidad estructural</div><div class="detail-value">' +
      (p.quality
        ? p.quality.score + "/100 · No sustituye pruebas funcionales"
        : "Pendiente de evaluación") +
      '</div></div><div><div class="detail-label">Firma del publicador</div><div class="detail-value">' +
      esc(p.signerFingerprint || "Paquete sin firma") +
      "</div></div></div>" +
      (p.deprecatedMessage ? "<p>" + esc(p.deprecatedMessage) + "</p>" : "") +
      '<h3 style="margin-top:24px">Dependencias</h3><pre>' +
      esc(
        Object.entries(p.manifest.dependencies || {})
          .map(([n, v]) => n + " " + v)
          .join("\n") || "Este paquete no tiene dependencias.",
      ) +
      "</pre><h3>Archivos que se instalarán</h3><pre>" +
      esc(
        (p.manifest.files || []).map((f) => f.target).join("\n") ||
          "Sin archivos",
      ) +
      "</pre>",
  );
}
