// Applies the saved or system colour theme before first paint, so the page never flashes.
// Kept as a tiny external file because the Content-Security-Policy forbids inline scripts.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('skillswap-theme');
  } catch (e) {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
