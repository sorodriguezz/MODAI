export const $ = (id) => document.getElementById(id);
let timer;
export function esc(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
}
export function date(v) {
  return v
    ? new Date(v).toLocaleString("es-CL", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Sin uso todavía";
}
export function notify(s, error = false) {
  clearTimeout(timer);
  $("toast").textContent = s;
  $("toast").className = "toast" + (error ? " error" : "");
  timer = setTimeout(() => $("toast").classList.add("hidden"), 5000);
}
export function modal(title, body) {
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = body;
  if (!$("modal").open) $("modal").showModal();
  setTimeout(
    () => $("modalBody").querySelector("input,textarea,button")?.focus(),
    50,
  );
}
export function toggleMenu(open) {
  $("sidebar").classList.toggle("open", open);
}
export function confirmAction(title, text, action) {
  modal(
    title,
    "<p>" +
      esc(text) +
      '</p><div class="dialog-foot"><button class="btn" data-click="closeModal">Cancelar</button><button class="btn danger" id="confirmAction">Confirmar</button></div>',
  );
  $("confirmAction").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await action();
      $("modal").close();
    } catch (err) {
      notify(err.message, true);
    } finally {
      e.target.disabled = false;
    }
  };
}
export async function submit(form, action) {
  const btn = form.querySelector('button[type="submit"],button');
  btn.disabled = true;
  try {
    await action();
  } catch (e) {
    notify(e.message, true);
  } finally {
    btn.disabled = false;
  }
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    notify("Copiado al portapapeles");
  } catch {
    notify(
      "No se pudo copiar. Selecciona el texto y cópialo manualmente.",
      true,
    );
  }
}
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) {
    const r = $("modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      $("modal").close();
  }
});
