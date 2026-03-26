// Shared auth utilities

function getToken() { return localStorage.getItem('token'); }
function getUser()  { return JSON.parse(localStorage.getItem('user') || 'null'); }

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
async function loadNotifications() {
  const res = await apiFetch('/api/notifications');
  if (!res || !res.ok) return;
  const data = await res.json();
  const badge = document.getElementById('notifBadge');
  if (badge) {
    if (data.unread > 0) {
      badge.textContent = data.unread > 9 ? '9+' : data.unread;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }
  return data;
}

function toggleNotifPanel() {
  // 簡易實作：點鈴鐺時標全部已讀並更新 badge
  apiFetch('/api/notifications/read-all', { method: 'PUT' }).then(() => {
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
  });
}

// 每 30 秒輪詢一次通知
setInterval(() => {
  if (document.getElementById('notifBadge')) loadNotifications();
}, 30000);
