(() => {
  const root = document.documentElement,
    system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";
  try {
    const saved = localStorage.getItem("modai-theme");
    if (["light", "dark", "system"].includes(saved)) preference = saved;
  } catch {}
  function apply() {
    root.dataset.theme =
      preference === "system"
        ? system.matches
          ? "dark"
          : "light"
        : preference;
  }
  window.modaiTheme = {
    get: () => preference,
    set: (value) => {
      if (!["light", "dark", "system"].includes(value)) return;
      preference = value;
      try {
        localStorage.setItem("modai-theme", value);
      } catch {}
      apply();
    },
  };
  system.addEventListener("change", () => {
    if (preference === "system") apply();
  });
  apply();
})();
