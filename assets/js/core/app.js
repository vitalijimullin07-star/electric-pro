document.addEventListener("DOMContentLoaded", () => {
  EP.AppShell.render();
  EP.VisualSettings?.init?.();
  EP.Router.init();
  EP.Auth.init();
});
