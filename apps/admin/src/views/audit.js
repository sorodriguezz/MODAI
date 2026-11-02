import { $, esc, date, notify } from "../lib/ui.js";
import { api } from "../lib/api.js";

export async function loadAudit() {
  try {
    const d = await api("/admin/audit?limit=100");
    $("auditEmpty").classList.toggle("hidden", d.events.length > 0);
    $("auditEmpty").textContent = "Sin actividad registrada todavía.";
    $("auditRows").innerHTML = d.events
      .map(
        (e) =>
          "<tr><td>" +
          esc(e.action) +
          '</td><td style="overflow-wrap:anywhere;max-width:350px">' +
          esc(e.resource) +
          '</td><td class="muted">' +
          esc(e.actor) +
          '</td><td class="muted">' +
          date(e.createdAt) +
          "</td></tr>",
      )
      .join("");
  } catch (e) {
    $("auditRows").innerHTML = "";
    $("auditEmpty").classList.remove("hidden");
    $("auditEmpty").textContent = e.message;
  }
}
export async function downloadBackup() {
  try {
    const data = await api("/admin/export");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      "modai-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Backup exportado");
  } catch (e) {
    notify(e.message, true);
  }
}
