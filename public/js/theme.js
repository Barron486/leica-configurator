/* ── Theme Toggle ───────────────────────────────────────────── */
(function () {
  // Apply stored theme before paint (also called from inline head script)
  var saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'light';
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  _syncToggle();
}

function _syncToggle() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  var input = document.getElementById('themeToggleInput');
  if (input) input.checked = isDark;
  var icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = isDark ? '☀' : '🌙';
}

document.addEventListener('DOMContentLoaded', _syncToggle);
