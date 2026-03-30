/* ── Theme Toggle ─────────────────────────── */
function toggleTheme() {
  var html = document.documentElement;
  var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  var icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = next === 'dark' ? '☀' : '🌙';
}

// Sync icon on page load
document.addEventListener('DOMContentLoaded', function () {
  if (document.documentElement.getAttribute('data-theme') === 'dark') {
    var icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = '☀';
  }
});
