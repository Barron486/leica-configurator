/* ── Theme Toggle ───────────────────────────────────────────── */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  _updateToggleLabel();
}

function _updateToggleLabel() {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = theme === 'dark' ? '☀' : '🌙';
}

document.addEventListener('DOMContentLoaded', _updateToggleLabel);
