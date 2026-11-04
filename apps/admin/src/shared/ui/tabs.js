const ARROWS = { ArrowRight: 1, ArrowLeft: -1 };

export function bindTabs(root, onChange) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = (tab) => {
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      root.querySelector(`[role="tabpanel"][data-panel="${item.dataset.tab}"]`).hidden = !active;
    });
    onChange?.(tab.dataset.tab);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const delta = ARROWS[event.key] || 0;
      if (!delta) return;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
}
