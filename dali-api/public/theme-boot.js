/* Applies saved theme before paint. Kept as a static file so CSP
 * script-src 'self' stays strict (no inline scripts). Keep in sync
 * with app/lib/theme.ts. */
(function () {
  try {
    var k = "dali:theme";
    var t = localStorage.getItem(k);
    if (t !== "light" && t !== "dark" && t !== "system") t = "system";
    var d =
      t === "dark" ||
      (t !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    var r = document.documentElement;
    r.classList.toggle("dark", d);
    r.classList.toggle("light", !d);
    r.style.colorScheme = d ? "dark" : "light";
  } catch (e) {
    /* ignore */
  }
})();
