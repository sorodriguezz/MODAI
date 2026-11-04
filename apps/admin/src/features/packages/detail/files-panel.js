import { get } from "../../../shared/lib/api.js";
import { base64ToBytes, bytesToText, formatBytes } from "../../../shared/lib/files.js";
import { html, mount } from "../../../shared/lib/html.js";
import { errorState } from "../../../shared/ui/empty-state.js";

function filesMarkup(files) {
  if (!files.length) return html`<p class="muted small">El paquete no contiene archivos.</p>`;
  return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Archivo</th><th scope="col" class="hide-sm">Tamaño</th></tr></thead>
          <tbody>${files.map((file) => html`<tr><td><button type="button" class="link-button" data-action="showFile" data-path="${file.path}"><code>${file.path}</code></button></td><td class="hide-sm">${formatBytes(base64ToBytes(file.content).length)}</td></tr>`)}</tbody></table></div>
          <div id="fileViewer"></div>`;
}

export async function loadFiles(body, item) {
  try {
    const files = (await get(`/artifacts/${encodeURIComponent(item.artifactId)}`)).files;
    mount(body.querySelector("#packageFiles"), filesMarkup(files));
    return files;
  } catch (error) {
    mount(body.querySelector("#packageFiles"), errorState(error));
    return null;
  }
}

export function showFile(body, file) {
  const text = bytesToText(base64ToBytes(file.content));
  mount(
    body.querySelector("#fileViewer"),
    html`<h4><code>${file.path}</code></h4>${text === null ? html`<p class="muted small">Archivo binario.</p>` : html`<pre class="pre-wrap document">${text}</pre>`}`,
  );
  body.querySelector("#fileViewer").scrollIntoView({ block: "nearest" });
}
