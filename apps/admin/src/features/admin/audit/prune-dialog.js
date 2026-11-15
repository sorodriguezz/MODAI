import { post } from "../../../shared/lib/api.js";
import { html } from "../../../shared/lib/html.js";
import { icon } from "../../../shared/lib/icons.js";
import { closeDialog, dialogFooter, openFormDialog } from "../../../shared/ui/dialog.js";
import { bindForm } from "../../../shared/ui/form.js";
import { debounce } from "../../../shared/ui/format.js";
import { toast } from "../../../shared/ui/toast.js";

const retention = {
  audit: {
    field: "auditDays",
    result: "audit",
    title: "Depurar auditoría",
    noun: "eventos de auditoría",
    days: 90,
    help: "Elimina los eventos registrados hace más de los días indicados. Usa 0 para vaciar la auditoría completa.",
  },
  memories: {
    field: "memoryDays",
    result: "memories",
    title: "Depurar memorias antiguas",
    noun: "memorias",
    days: 365,
    help: "Elimina, en todos los proyectos, las memorias que no se actualizan hace más de los días indicados. Usa 0 para eliminarlas todas.",
  },
};

export function pruneDialog(target, onDone) {
  const config = retention[target];
  const { body, form } = openFormDialog({
    title: config.title,
    description: config.help,
    size: "sm",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="pruneDays">Más antiguos que (días)</label><input id="pruneDays" type="number" min="0" max="36500" step="1" value="${config.days}" required></div>
      <p class="callout tone-info" id="prunePreview" aria-live="polite">${icon("info")}<span>Calculando…</span></p>
      <div class="callout tone-danger">${icon("alert")}<span>Lo eliminado no se puede recuperar. Exporta un backup antes si lo necesitas.</span></div>
      ${dialogFooter("Depurar", { tone: "danger", disabled: true })}
    </form>`,
  });
  const submit = form.querySelector('button[type="submit"]'),
    preview = body.querySelector("#prunePreview span");
  let count = 0,
    sequence = 0;
  const refresh = debounce(async () => {
    const days = Number(form.pruneDays.value),
      mine = ++sequence;
    if (!form.pruneDays.checkValidity()) {
      preview.textContent = "Indica un número de días entre 0 y 36500.";
      submit.disabled = true;
      return;
    }
    try {
      const result = await post("/admin/prune", { [config.field]: days, dryRun: true });
      if (mine !== sequence) return;
      count = result[config.result];
      preview.textContent = count
        ? `Se eliminarán ${count} ${config.noun}.`
        : `No hay ${config.noun} con esa antigüedad: no se eliminará nada.`;
      submit.disabled = count === 0;
      submit.textContent = count ? `Eliminar ${count} ${config.noun}` : "Depurar";
    } catch (error) {
      preview.textContent = error.message;
    }
  }, 250);
  form.pruneDays.addEventListener("input", refresh);
  refresh();
  bindForm(form, async () => {
    const result = await post("/admin/prune", { [config.field]: Number(form.pruneDays.value) });
    closeDialog();
    toast(`Depuración completa: ${result[config.result]} ${config.noun} eliminados`);
    await onDone?.();
  });
}
