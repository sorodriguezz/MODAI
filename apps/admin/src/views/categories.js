import { html, mount, delegate } from "../lib/html.js";
import { icon } from "../lib/icons.js";
import { get, post, patch, del } from "../lib/api.js";
import { openDialog, closeDialog, bindForm, confirmDialog, toast, skeletonRows, emptyState, errorState, debounce } from "../lib/ui.js";
import { can } from "../state.js";

function categoryForm(category, onSaved) {
  const editing = Boolean(category?.registered);
  const body = openDialog({
    title: editing ? "Categoría " + category.name : "Nueva categoría",
    description: "Las categorías ordenan el catálogo: el panel las ofrece al crear paquetes y templates, y sirven para filtrar y para modai list <categoría>.",
    size: "md",
    body: html`<form class="stack" novalidate>
      <div class="field"><label for="catName">Nombre</label><input id="catName" required maxlength="64" pattern="[a-z][a-z0-9\\-]{0,63}" spellcheck="false" autocapitalize="off" placeholder="backend" value="${category?.name || ""}" ${category ? "disabled" : ""}><p class="hint">En minúsculas, con guiones. No se puede renombrar: los paquetes publicados la guardan en su manifiesto.</p></div>
      <div class="field"><label for="catDescription">Descripción</label><textarea id="catDescription" rows="2" maxlength="500" placeholder="Qué tipo de paquetes van aquí.">${category?.description || ""}</textarea><p class="hint">Se muestra al elegirla en el editor.</p></div>
      <div class="form-error" role="alert" hidden></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-dismiss>Cancelar</button><button type="submit" class="btn primary">${editing ? "Guardar" : "Crear categoría"}</button></div>
    </form>`,
  });
  const form = body.querySelector("form");
  form.querySelector("[data-dismiss]").addEventListener("click", closeDialog);
  bindForm(form, async () => {
    const description = form.catDescription.value.trim();
    if (editing) await patch("/categories/" + encodeURIComponent(category.name), { description });
    else await post("/categories", { name: (category?.name || form.catName.value).trim().toLowerCase(), description });
    closeDialog();
    toast(editing ? "Categoría actualizada" : "Categoría creada");
    await onSaved();
  });
}

export default {
  id: "categories",
  label: "Categorías",
  icon: "book",
  title: "Categorías",
  subtitle: "Las categorías del catálogo: las que el panel ofrece al crear paquetes y templates.",
  visible: () => can.admin(),
  async render(root, { actions, isCurrent }) {
    mount(root, html`
      <div class="callout tone-info">${icon("info")}<span>Una categoría es <b>informativa</b>: no cambia cómo se instala un paquete. El editor solo ofrece las registradas aquí, así el catálogo no se llena de variantes. Las que usan paquetes publicados sin estar registradas aparecen como <b>sin registrar</b>.</span></div>
      <div class="toolbar"><div class="search-field">${icon("search")}<label class="sr-only" for="catSearch">Buscar categorías</label><input id="catSearch" type="search" placeholder="Buscar por nombre o descripción…"></div></div>
      <div class="panel" id="catResults">${skeletonRows(4, 3)}</div>`);
    let categories = [];
    mount(actions, html`<button class="btn primary" data-action="newCategory">${icon("plus")}Nueva categoría</button>`);

    const draw = () => {
      const q = root.querySelector("#catSearch").value.trim().toLocaleLowerCase();
      const list = categories.filter((c) => !q || [c.name, c.description].join(" ").toLocaleLowerCase().includes(q));
      mount(root.querySelector("#catResults"), list.length
        ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th scope="col">Categoría</th><th scope="col">Estado</th><th scope="col" class="hide-sm">Paquetes</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${list.map((c) => html`<tr>
            <td><code>${c.name}</code>${c.description ? html`<div class="muted small">${c.description}</div>` : ""}</td>
            <td>${c.registered ? html`<span class="badge tone-success">Registrada</span>` : html`<span class="badge tone-warning" title="La usan paquetes publicados, pero el editor no la ofrece">Sin registrar</span>`}</td>
            <td class="hide-sm">${c.packages ? html`<a href="#/packages?category=${encodeURIComponent(c.name)}">${c.packages}</a>` : html`<span class="muted">0</span>`}</td>
            <td class="actions">${c.registered
              ? html`<button type="button" class="btn small ghost" data-action="editCategory" data-name="${c.name}">${icon("edit", 16)}<span class="hide-sm">Editar</span></button>
                <button type="button" class="icon-button small danger" data-action="deleteCategory" data-name="${c.name}" aria-label="Eliminar ${c.name}">${icon("trash", 16)}</button>`
              : html`<button type="button" class="btn small" data-action="registerCategory" data-name="${c.name}">${icon("plus", 16)}Registrar</button>`}</td>
          </tr>`)}</tbody></table></div>`
        : categories.length ? emptyState({ iconName: "search", title: "Sin coincidencias" })
          : emptyState({ iconName: "book", title: "Aún no hay categorías", text: "Crea las categorías que usará tu equipo: backend, frontend, testing…", action: html`<button class="btn primary" data-action="newCategory">${icon("plus")}Nueva categoría</button>` }));
    };

    const load = async () => {
      try {
        ({ categories } = await get("/categories"));
      } catch (error) {
        if (isCurrent()) mount(root.querySelector("#catResults"), errorState(error));
        return;
      }
      if (isCurrent()) draw();
    };
    root.querySelector("#catSearch").addEventListener("input", debounce(draw));
    const find = (button) => categories.find((item) => item.name === button.dataset.name);

    const handlers = {
      newCategory: () => categoryForm(null, load),
      editCategory: (button) => { const c = find(button); if (c) categoryForm(c, load); },
      registerCategory: (button) => { const c = find(button); if (c) categoryForm({ ...c, registered: false }, load); },
      deleteCategory: async (button) => {
        const c = find(button);
        if (!c) return;
        const ok = await confirmDialog({
          title: "Eliminar categoría",
          message: c.packages
            ? html`<code>${c.name}</code> la usan ${c.packages} ${c.packages === 1 ? "paquete" : "paquetes"}. Las versiones publicadas no cambian: la conservan y pasa a figurar como sin registrar. El editor dejará de ofrecerla.`
            : html`El editor dejará de ofrecer <code>${c.name}</code>.`,
          confirmLabel: "Eliminar categoría",
          action: () => del("/categories/" + encodeURIComponent(c.name)),
        });
        if (ok) { toast("Categoría eliminada"); await load(); }
      },
      retry: load,
    };
    delegate(root, handlers);
    delegate(actions, handlers);
    await load();
  },
};
