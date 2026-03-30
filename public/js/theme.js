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
  const btn = document.getElementById('themeToggle');
  if (btn) btn.innerHTML = theme === 'dark' ? '☀ 淺色模式' : '🌙 深色模式';
}

document.addEventListener('DOMContentLoaded', _updateToggleLabel);
