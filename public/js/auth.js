// Shared auth utilities

function getToken() { return localStorage.getItem('token'); }
function getUser()  { return JSON.parse(localStorage.getItem('user') || 'null'); }

// ── Sidebar collapse ──────────────────────
function toggleSidebarCollapse() {
  const sidebar = document.querySelector('.sidebar');
  const shell   = document.querySelector('.app-shell');
  if (!sidebar) return;
  const collapsed = sidebar.classList.toggle('collapsed');
  if (shell) shell.classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}

(function initSidebarCollapse() {
  if (localStorage.getItem('sidebarCollapsed') !== '1') return;
  function applyCollapse() {
    const sidebar = document.querySelector('.sidebar');
    const shell   = document.querySelector('.app-shell');
    if (sidebar) sidebar.classList.add('collapsed');
    if (shell)   shell.classList.add('sidebar-collapsed');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyCollapse);
  } else {
    applyCollapse();
  }
})();

function requireAuth() {
  const user = getUser();
  if (!user) { window.location = '/login.html'; return null; }
  return user;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location = '/login.html';
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) { logout(); return null; }
  return res;
}

function formatPrice(num, currency = 'TWD') {
  if (!num || num === 0) return '—';
  return new Intl.NumberFormat('zh-TW', { style: 'currency', currency, maximumFractionDigits: 0 }).format(num);
}

function showToast(msg, type = '') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

const CATEGORY_LABELS = {
  base:         '基礎配置',
  orientation:  '檢體夾具固定裝置',
  clamping:     '快速夾緊系統',
  holder:       '檢體夾具',
  blade_base:   '刀架底座',
  blade_holder: '刀架 / 刀片架',
  blade:        '刀片（耗材）',
  cooling:      '冷卻系統',
  lighting:     '照明與觀察',
  accessory:    '其他配件',
};

const ROLE_LABELS = {
  admin:       '管理員',
  super_admin: '超級管理員',
  demo:        'DEMO',
  sales:       '業務',
  customer:    '客戶',
  finance:     '財務部',
  management:  '管理部',
  gm:          '總經理',
  pm:          'PM',
};

const STATUS_LABELS = {
  draft:       '草稿',
  pending_pm:  '待 PM 審核',
  pending_gm:  '待總經理審核',
  submitted:   '待管理部用印',
  approved:    '已核准',
  rejected:    '已退回',
};

// ── 通知相關 ──────────────────────────────────────────────────
let _notifItems = [];
let _notifPanel = null;

function _escN(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _timeAgo(str) {
  if (!str) return '';
  const diff = Date.now() - new Date(str).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return '剛剛';
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

async function loadNotifications() {
  const res = await apiFetch('/api/notifications');
  if (!res || !res.ok) return;
  const data = await res.json();
  _notifItems = data.notifications || [];
  const badge = document.getElementById('notifBadge');
  if (badge) {
    if (data.unread > 0) {
      badge.textContent = data.unread > 9 ? '9+' : data.unread;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
  // 面板開著就同步更新內容
  if (_notifPanel && _notifPanel.style.display !== 'none') _renderNotifPanel();
  return data;
}

function _renderNotifPanel() {
  if (!_notifPanel) return;
  if (!_notifItems.length) {
    _notifPanel.innerHTML = '<div style="padding:28px 16px;text-align:center;color:#999;font-size:13px">目前沒有通知</div>';
    return;
  }
  _notifPanel.innerHTML = `
    <div style="padding:10px 14px 10px 16px;font-weight:700;font-size:13px;border-bottom:1px solid #EBEBEB;display:flex;justify-content:space-between;align-items:center">
      <span>通知</span>
      <button onclick="event.stopPropagation();_markAllRead()" style="background:none;border:none;font-size:12px;color:#0066CC;cursor:pointer;padding:0">全部已讀</button>
    </div>
    <div style="max-height:380px;overflow-y:auto">
      ${_notifItems.map(n => `
        <div onclick="_clickNotif(${n.id},'${_escN(n.link)}')"
             style="padding:12px 16px;border-bottom:1px solid #F4F4F4;cursor:pointer;background:${n.read ? 'transparent' : '#EFF6FF'}">
          <div style="font-size:13px;font-weight:${n.read ? '400' : '600'};margin-bottom:3px;color:#1A1A2E">${_escN(n.title)}</div>
          ${n.body ? `<div style="font-size:12px;color:#555;margin-bottom:5px;line-height:1.45">${_escN(n.body)}</div>` : ''}
          <div style="font-size:11px;color:#AAA">${_timeAgo(n.created_at)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

async function _clickNotif(id, link) {
  await apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' });
  _notifItems = _notifItems.map(n => n.id === id ? {...n, read: 1} : n);
  if (_notifPanel) _notifPanel.style.display = 'none';
  if (link && link !== 'undefined' && link !== '') {
    window.location.href = link;
  } else {
    loadNotifications();
  }
}

async function _markAllRead() {
  await apiFetch('/api/notifications/read-all', { method: 'PUT' });
  _notifItems = _notifItems.map(n => ({...n, read: 1}));
  const badge = document.getElementById('notifBadge');
  if (badge) badge.style.display = 'none';
  _renderNotifPanel();
}

function _closeNotifPanel(e) {
  if (!_notifPanel) return;
  const btn = document.getElementById('notifBtn');
  if (btn && btn.contains(e.target)) return; // 讓 toggle 自己處理
  if (_notifPanel.contains(e.target)) return;
  _notifPanel.style.display = 'none';
}

function toggleNotifPanel() {
  const btn = document.getElementById('notifBtn');
  if (!btn) return;

  if (!_notifPanel) {
    _notifPanel = document.createElement('div');
    _notifPanel.style.cssText = [
      'position:fixed',
      'width:320px',
      'background:#FFF',
      'border:1px solid #E0E0E0',
      'border-radius:10px',
      'box-shadow:0 6px 24px rgba(0,0,0,0.13)',
      'z-index:2000',
      'font-family:inherit',
    ].join(';');
    document.body.appendChild(_notifPanel);
    document.addEventListener('click', _closeNotifPanel, true);
  }

  if (_notifPanel.style.display === 'block') {
    _notifPanel.style.display = 'none';
    return;
  }

  // 定位在鈴鐺按鈕下方
  const rect = btn.getBoundingClientRect();
  const panelRight = Math.max(8, window.innerWidth - rect.right);
  _notifPanel.style.top  = (rect.bottom + 8) + 'px';
  _notifPanel.style.right = panelRight + 'px';
  _notifPanel.style.removeProperty('left');

  _renderNotifPanel();
  _notifPanel.style.display = 'block';
}

// 每 30 秒輪詢一次通知
setInterval(() => {
  if (document.getElementById('notifBadge')) loadNotifications();
}, 30000);
