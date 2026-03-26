// ── Init ──────────────────────────────────────────────────────
const REVIEWER_ROLES   = ['admin', 'super_admin', 'finance', 'management', 'gm', 'pm'];
const ADMIN_ONLY_ROLES = ['admin', 'super_admin'];

let _currentUser = null;

(async function init() {
  const user = requireAuth();
  if (!user) return;
  if (!REVIEWER_ROLES.includes(user.role)) { window.location = '/index.html'; return; }

  _currentUser = user;
  document.getElementById('userName').textContent = user.display_name;

  const badge = document.getElementById('roleBadge');
  badge.textContent = ROLE_LABELS[user.role] || user.role;
  badge.className = `role-badge role-${user.role}`;

  // 顯示「我的報價單」連結（非 customer/demo）
  const mqLink = document.getElementById('myQuotesLink');
  if (mqLink && !['customer','demo'].includes(user.role)) mqLink.style.display = 'block';

  loadNotifications();

  // 依 role_permissions 動態控制 tabs
  await applyRolePermTabs(user);

  loadQuotes();
})();

// ── Role Permission Tab Control ───────────────────────────────
// tab key → role_permissions 欄位對應
const TAB_PERM_MAP = {
  quotes:    'manage_quotes',
  pricing:   'manage_pricing',
  products:  'manage_products',
  users:     'manage_users',
  bom:       'manage_bom',
  approvals: 'manage_approval',
  import:    'import_products',
  // roleperms / catalog → admin/super_admin only，不在此表
};

async function applyRolePermTabs(user) {
  const isAdmin = ADMIN_ONLY_ROLES.includes(user.role);

  if (isAdmin) {
    // admin/super_admin 全部顯示；僅 super_admin 顯示系統設定 tab
    document.querySelectorAll('.tab-btn').forEach(btn => btn.style.display = '');
    if (user.role !== 'super_admin') {
      const settingsBtn = document.getElementById('tab-btn-settings');
      if (settingsBtn) settingsBtn.style.display = 'none';
    }
    return;
  }

  // 取得此角色的 role_permissions
  const res = await apiFetch('/api/admin/role-permissions/me');
  const rp = (res && res.ok) ? await res.json() : {};

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.getAttribute('onclick')?.match(/switchTab\('(\w+)'\)/)?.[1];
    if (!tab) return;

    // roleperms / catalog 非 admin 不顯示
    if (tab === 'roleperms' || tab === 'catalog') {
      btn.style.display = 'none';
      return;
    }

    const permKey = TAB_PERM_MAP[tab];
    if (permKey && !rp[permKey]) {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
  });
}

// ── Tab Switching ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  event.currentTarget.classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');

  if (name === 'quotes')    loadQuotes();
  if (name === 'pricing')   loadPricing();
  if (name === 'products')  loadProducts();
  if (name === 'users')     loadUsers();
  if (name === 'roleperms') loadRolePermissions();
  if (name === 'bom')       loadBoms();
  if (name === 'approvals') loadChain();
  if (name === 'catalog')   loadCatalogItems();
  if (name === 'customers') loadCustomers();
  if (name === 'settings')  loadApiSettings();
}

// ── Quotes ────────────────────────────────────────────────────
async function loadQuotes() {
  const filter = document.getElementById('quoteFilter')?.value || '';
  const res = await apiFetch(`/api/admin/quotes${filter ? '?status=' + filter : ''}`);
  if (!res || !res.ok) return;
  const quotes = await res.json();

  const tbody = document.getElementById('quotesBody');
  if (!quotes.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted">無報價單</td></tr>';
    return;
  }

  tbody.innerHTML = quotes.map(q => {
    const margin = q.gross_margin_pct;
    const lowMargin = margin !== null && margin !== undefined && margin < 15;
    const marginHtml = margin !== null && margin !== undefined
      ? `<span style="color:${lowMargin ? '#DC3545' : '#28A745'}; font-weight:${lowMargin ? '700' : '400'}">${margin}%${lowMargin ? ' ⚠' : ''}</span>`
      : '<span class="text-muted">—</span>';

    return `
    <tr${lowMargin ? ' style="background:#FFF5F5"' : ''}>
      <td><strong>${q.quote_number}</strong></td>
      <td>${q.customer_name}</td>
      <td>${q.customer_org || '—'}</td>
      <td>${q.sales_name || '—'}</td>
      <td><span class="status-badge status-${q.status}">${STATUS_LABELS[q.status] || q.status}</span></td>
      <td>${marginHtml}</td>
      <td class="text-small text-muted">${formatDate(q.created_at)}</td>
      <td><button class="btn btn-outline btn-sm" onclick="openQuoteDetail(${q.id})">查看</button></td>
    </tr>`;
  }).join('');
}

async function openQuoteDetail(id) {
  const res = await apiFetch(`/api/quotes/${id}`);
  if (!res || !res.ok) return;
  const q = await res.json();

  document.getElementById('quoteDetailTitle').textContent = `報價單 ${q.quote_number}`;

  const total = q.items.reduce((s, it) => s + (it.unit_price_snapshot * it.quantity), 0);
  const costRes = await apiFetch(`/api/admin/quotes?status=`);
  // Get margin from the list view data (already calculated)
  // We'll recalculate in the detail view from items

  let itemsHtml = q.items.map(it => `
    <tr>
      <td>${it.catalog_number}</td>
      <td>${it.name_zh}</td>
      <td style="text-align:center">${it.quantity}</td>
      <td style="text-align:right">${it.unit_price_snapshot > 0 ? formatPrice(it.unit_price_snapshot) : '洽詢'}</td>
    </tr>
  `).join('');

  const isPendingGm = q.status === 'pending_gm';
  const canReview = q.status === 'submitted' || (isPendingGm && ['admin','gm'].includes(_currentUser?.role));

  document.getElementById('quoteDetailBody').innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px; font-size:13px">
      <div><strong>客戶：</strong>${q.customer_name}</div>
      <div><strong>單位：</strong>${q.customer_org || '—'}</div>
      <div><strong>Email：</strong>${q.customer_email || '—'}</div>
      <div><strong>電話：</strong>${q.customer_phone || '—'}</div>
      <div><strong>業務：</strong>${q.sales_name || '—'}</div>
      <div><strong>狀態：</strong><span class="status-badge status-${q.status}">${STATUS_LABELS[q.status] || q.status}</span></div>
      <div><strong>建立：</strong>${formatDate(q.created_at)}</div>
      <div><strong>提交：</strong>${q.submitted_at ? formatDate(q.submitted_at) : '—'}</div>
    </div>
    ${q.case_notes ? `<div style="background:#F0F4FF;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px"><strong>案件說明：</strong>${q.case_notes}</div>` : ''}
    ${isPendingGm ? `<div class="alert" style="background:#FFF3CD;color:#856404;margin-bottom:12px;border-left:4px solid #FFC107">⚠ 此報價單包含低於最低售價的品項，需總經理審核</div>` : ''}
    <table class="data-table" style="margin-bottom:12px">
      <thead><tr><th>料號</th><th>品名</th><th>數量</th><th>單價</th></tr></thead>
      <tbody>
        ${itemsHtml}
        <tr style="font-weight:700; background:#F5F5F7">
          <td colspan="3" style="text-align:right">合計</td>
          <td style="text-align:right">${total > 0 ? formatPrice(total) : '洽詢'}</td>
        </tr>
      </tbody>
    </table>
    ${q.admin_notes ? `<div style="font-size:13px"><strong>審核備註：</strong>${q.admin_notes}</div>` : ''}
  `;

  const footer = document.getElementById('quoteDetailFooter');
  footer.innerHTML = '';

  if (canReview) {
    const notesInput = document.createElement('input');
    notesInput.type = 'text';
    notesInput.id = 'adminNotes';
    notesInput.placeholder = '備註（退回時必填）';
    notesInput.style.cssText = 'flex:1; padding:8px 12px; border:1px solid #DDD; border-radius:4px; font-size:13px';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-outline';
    closeBtn.textContent = '關閉';
    closeBtn.onclick = () => closeModal('quoteDetailModal');

    const approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary';
    approveBtn.textContent = isPendingGm ? '總經理核准' : '核准';
    approveBtn.style.cssText = 'background:#28A745; border-color:#28A745';
    approveBtn.onclick = () => reviewQuote(q.id, 'approved');

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-primary';
    rejectBtn.textContent = '退回';
    rejectBtn.style.cssText = 'background:#DC3545; border-color:#DC3545';
    rejectBtn.onclick = () => reviewQuote(q.id, 'rejected');

    footer.appendChild(notesInput);
    footer.appendChild(closeBtn);
    footer.appendChild(approveBtn);
    footer.appendChild(rejectBtn);
  } else {
    footer.innerHTML = `<button class="btn btn-outline" onclick="closeModal('quoteDetailModal')">關閉</button>`;
  }

  // 管理員可刪除報價單
  if (ADMIN_ONLY_ROLES.includes(_currentUser?.role)) {
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-outline';
    delBtn.style.cssText = 'color:#DC3545; border-color:#DC3545; margin-left:auto';
    delBtn.textContent = '刪除';
    delBtn.onclick = () => deleteQuoteAdmin(q.id, q.quote_number);
    footer.appendChild(delBtn);
  }

  document.getElementById('quoteDetailModal').classList.add('open');
}

async function reviewQuote(id, action) {
  const notes = document.getElementById('adminNotes')?.value || '';
  if (action === 'rejected' && !notes.trim()) {
    showToast('退回時請填寫備註原因', 'error');
    document.getElementById('adminNotes')?.focus();
    return;
  }
  const endpoint = action === 'approved' ? 'approve' : 'reject';
  const res = await apiFetch(`/api/quotes/${id}/${endpoint}`, {
    method: 'PUT',
    body: JSON.stringify({ admin_notes: notes }),
  });
  if (!res || !res.ok) { showToast('操作失敗', 'error'); return; }
  closeModal('quoteDetailModal');
  showToast(action === 'approved' ? '已核准' : '已退回', 'success');
  loadQuotes();
}

async function deleteQuoteAdmin(id, num) {
  if (!confirm(`確定刪除報價單「${num}」？此操作無法復原。`)) return;
  const res = await apiFetch(`/api/quotes/${id}`, { method: 'DELETE' });
  if (!res || !res.ok) { showToast('刪除失敗', 'error'); return; }
  closeModal('quoteDetailModal');
  showToast('已刪除', 'success');
  loadQuotes();
}

// ── Pricing ───────────────────────────────────────────────────
async function loadPricing() {
  const res = await apiFetch('/api/admin/products');
  if (!res || !res.ok) return;
  const products = await res.json();

  const tbody = document.getElementById('pricingBody');
  tbody.innerHTML = products.map(p => `
    <tr>
      <td class="text-small">${p.catalog_number}</td>
      <td>${p.name_zh}</td>
      <td class="price-cost">${p.cost_price > 0 ? formatPrice(p.cost_price) : '—'}</td>
      <td style="color:#7B1FA2">${p.min_sell_price > 0 ? formatPrice(p.min_sell_price) : '—'}</td>
      <td class="price-suggest">${p.suggested_price > 0 ? formatPrice(p.suggested_price) : '—'}</td>
      <td class="price-retail">${p.retail_price > 0 ? formatPrice(p.retail_price) : '—'}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="openPricingEdit(${p.id}, ${p.cost_price||0}, ${p.min_sell_price||0}, ${p.suggested_price||0}, ${p.retail_price||0}, '${escapeJs(p.pricing_notes||'')}')">編輯</button>
      </td>
    </tr>
  `).join('');
}

function openPricingEdit(productId, cost, min, suggest, retail, notes) {
  document.getElementById('pricing_product_id').value = productId;
  document.getElementById('p_cost').value = cost || '';
  document.getElementById('p_min').value = min || '';
  document.getElementById('p_suggest').value = suggest || '';
  document.getElementById('p_retail').value = retail || '';
  document.getElementById('p_notes').value = notes || '';
  document.getElementById('pricingModal').classList.add('open');
}

async function savePricing() {
  const productId = document.getElementById('pricing_product_id').value;
  const body = {
    cost_price:      parseFloat(document.getElementById('p_cost').value) || 0,
    min_sell_price:  parseFloat(document.getElementById('p_min').value) || 0,
    suggested_price: parseFloat(document.getElementById('p_suggest').value) || 0,
    retail_price:    parseFloat(document.getElementById('p_retail').value) || 0,
    notes:           document.getElementById('p_notes').value,
  };
  const res = await apiFetch(`/api/admin/pricing/${productId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) { showToast('儲存失敗', 'error'); return; }
  closeModal('pricingModal');
  showToast('價格已更新', 'success');
  loadPricing();
}

// ── Products ──────────────────────────────────────────────────
async function loadProducts() {
  const res = await apiFetch('/api/admin/products');
  if (!res || !res.ok) return;
  const products = await res.json();

  const tbody = document.getElementById('productsBody');
  tbody.innerHTML = products.map(p => `
    <tr>
      <td class="text-small">${p.catalog_number}</td>
      <td>${p.name_zh}</td>
      <td class="text-small text-muted">${CATEGORY_LABELS[p.category] || p.category}</td>
      <td class="text-small">${p.pm_name ? `<span class="role-badge role-pm">${p.pm_name}</span>` : '<span class="text-muted">—</span>'}</td>
      <td>
        <span class="status-badge" style="background:${p.active ? '#D4EDDA' : '#F8D7DA'}; color:${p.active ? '#155724' : '#721C24'}">
          ${p.active ? '啟用' : '停用'}
        </span>
      </td>
      <td style="display:flex; gap:6px; flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onclick="openEditProduct(${p.id}, '${escapeJs(p.catalog_number)}', '${escapeJs(p.name_zh)}', '${escapeJs(p.name_en||'')}', '${p.category}', '${escapeJs(p.description||'')}', '${escapeJs(p.notes||'')}', ${p.sort_order??99}, ${p.pm_user_id||'null'})">編輯</button>
        <button class="btn btn-outline btn-sm" onclick="toggleProduct(${p.id}, ${p.active})">
          ${p.active ? '停用' : '啟用'}
        </button>
        <button class="btn btn-outline btn-sm" onclick="openDepModal(${p.id}, '${escapeJs(p.name_zh)}')">關聯</button>
      </td>
    </tr>
  `).join('');
}

let _pmUsers = [];
async function _loadPmUsers() {
  if (_pmUsers.length) return;
  const res = await apiFetch('/api/admin/users');
  if (res && res.ok) {
    const users = await res.json();
    _pmUsers = users.filter(u => u.role === 'pm');
    const sel = document.getElementById('np_pm');
    sel.innerHTML = '<option value="">— 不指派 —</option>' +
      _pmUsers.map(u => `<option value="${u.id}">${u.display_name} (${u.username})</option>`).join('');
  }
}

async function openAddProduct() {
  document.getElementById('np_id').value = '';
  ['np_code','np_name_zh','np_name_en','np_desc','np_notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('np_sort').value = '99';
  document.getElementById('np_category').value = 'accessory';
  document.getElementById('np_code').disabled = false;
  document.getElementById('productModalTitle').textContent = '新增產品';
  document.getElementById('productModalSaveBtn').textContent = '新增';
  await _loadPmUsers();
  document.getElementById('np_pm').value = '';
  document.getElementById('productModal').classList.add('open');
}

async function openEditProduct(id, code, name_zh, name_en, category, desc, notes, sort, pmUserId) {
  document.getElementById('np_id').value = id;
  document.getElementById('np_code').value = code;
  document.getElementById('np_code').disabled = true;
  document.getElementById('np_name_zh').value = name_zh;
  document.getElementById('np_name_en').value = name_en;
  document.getElementById('np_category').value = category;
  document.getElementById('np_desc').value = desc;
  document.getElementById('np_notes').value = notes;
  document.getElementById('np_sort').value = sort;
  document.getElementById('productModalTitle').textContent = '編輯產品';
  document.getElementById('productModalSaveBtn').textContent = '儲存';
  await _loadPmUsers();
  document.getElementById('np_pm').value = pmUserId || '';
  document.getElementById('productModal').classList.add('open');
}

async function saveProduct() {
  const id = document.getElementById('np_id').value;
  const code = document.getElementById('np_code').value.trim();
  const name = document.getElementById('np_name_zh').value.trim();
  if (!name) { showToast('中文名稱為必填', 'error'); return; }
  if (!id && !code) { showToast('料號為必填', 'error'); return; }

  const body = {
    name_zh: name,
    name_en: document.getElementById('np_name_en').value.trim(),
    category: document.getElementById('np_category').value,
    description: document.getElementById('np_desc').value.trim(),
    notes: document.getElementById('np_notes').value.trim(),
    sort_order: parseInt(document.getElementById('np_sort').value) || 99,
    pm_user_id: document.getElementById('np_pm').value || null,
  };

  let res;
  if (id) {
    res = await apiFetch(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  } else {
    body.catalog_number = code;
    res = await apiFetch('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
  }

  if (!res || !res.ok) {
    const err = await res?.json();
    showToast(err?.error || (id ? '修改失敗' : '新增失敗'), 'error');
    return;
  }
  closeModal('productModal');
  showToast(id ? '產品已更新' : '產品已新增', 'success');
  loadProducts();
}

async function toggleProduct(id, currentActive) {
  const res = await apiFetch(`/api/admin/products/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ active: currentActive ? 0 : 1 }),
  });
  if (!res || !res.ok) { showToast('操作失敗', 'error'); return; }
  showToast(currentActive ? '已停用' : '已啟用', 'success');
  loadProducts();
}

// ── Users ─────────────────────────────────────────────────────
async function loadUsers() {
  const res = await apiFetch('/api/admin/users');
  if (!res || !res.ok) return;
  const users = await res.json();

  const tbody = document.getElementById('usersBody');
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.username}</td>
      <td>${u.display_name || '—'}</td>
      <td><span class="role-badge role-${u.role}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td class="text-small text-muted">${u.email || '—'}</td>
      <td class="text-small" style="font-family:var(--font-mono);font-size:11px;color:#555">${u.quote_prefix || '—'}</td>
      <td class="text-small text-muted">${formatDate(u.created_at)}</td>
      <td><button class="btn btn-outline btn-sm" onclick="openEditUser(${u.id}, '${escapeJs(u.username)}', '${u.role}', '${escapeJs(u.display_name||'')}', '${escapeJs(u.email||'')}', '${escapeJs(u.quote_prefix||'')}')">編輯</button></td>
    </tr>
  `).join('');
}

function openAddUser() {
  document.getElementById('userModalTitle').textContent = '新增用戶';
  document.getElementById('user_id').value = '';
  document.getElementById('pwdHint').style.display = 'none';
  ['u_username','u_password','u_display','u_email','u_quote_prefix'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('u_role').value = 'sales';
  document.getElementById('userModal').classList.add('open');
}

function openEditUser(id, username, role, display, email, quotePrefix = '') {
  document.getElementById('userModalTitle').textContent = '編輯用戶';
  document.getElementById('user_id').value = id;
  document.getElementById('u_username').value = username;
  document.getElementById('u_password').value = '';
  document.getElementById('u_role').value = role;
  document.getElementById('u_display').value = display;
  document.getElementById('u_email').value = email;
  document.getElementById('u_quote_prefix').value = quotePrefix;
  document.getElementById('pwdHint').style.display = 'inline';
  document.getElementById('userModal').classList.add('open');
}

async function saveUser() {
  const id = document.getElementById('user_id').value;
  const username = document.getElementById('u_username').value.trim();
  const password = document.getElementById('u_password').value;
  if (!username) { showToast('帳號為必填', 'error'); return; }
  if (!id && !password) { showToast('新增用戶需設定密碼', 'error'); return; }

  const body = {
    username,
    role: document.getElementById('u_role').value,
    display_name: document.getElementById('u_display').value.trim(),
    email: document.getElementById('u_email').value.trim(),
    quote_prefix: document.getElementById('u_quote_prefix').value.trim().toUpperCase(),
  };
  if (password) body.password = password;

  const isEdit = !!id;
  const res = await apiFetch(isEdit ? `/api/admin/users/${id}` : '/api/admin/users', {
    method: isEdit ? 'PUT' : 'POST',
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) {
    const err = await res?.json();
    showToast(err?.error || '儲存失敗', 'error');
    return;
  }
  closeModal('userModal');
  showToast(isEdit ? '用戶已更新' : '用戶已新增', 'success');
  loadUsers();
}

// ── Shared ────────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' });
}

function escapeJs(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ── Import Products ───────────────────────────────────────────
let _importProducts = [];
let _importType = 'excel'; // 'excel' | 'pdf'

function setImportType(type) {
  _importType = type;
  const isExcel = type === 'excel';
  document.getElementById('importTypeExcel').className = isExcel ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
  document.getElementById('importTypePdf').className   = isExcel ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
  document.getElementById('dropZoneIcon').textContent  = isExcel ? '📊' : '📄';
  document.getElementById('dropZoneText').textContent  = isExcel ? '點擊或拖曳 Excel 檔案到此處' : '點擊或拖曳 PDF 檔案到此處';
  document.getElementById('dropZoneHint').textContent  = isExcel ? '.xlsx / .xls，最大 10MB' : '.pdf，最大 10MB（需含可選取文字）';
}

function triggerFileInput() {
  const id = _importType === 'pdf' ? 'pdfFileInput' : 'excelFileInput';
  document.getElementById(id).click();
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').style.borderColor = '#CCC';
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (file) processFile(file);
}

async function processFile(file) {
  const isPdf   = file.name.match(/\.pdf$/i);
  const isExcel = file.name.match(/\.xlsx?$/i);

  if (!isPdf && !isExcel) {
    showToast('請選擇 .xlsx、.xls 或 .pdf 檔案', 'error');
    return;
  }
  // 自動切換 type 顯示
  if (isPdf)   setImportType('pdf');
  if (isExcel) setImportType('excel');

  // Show progress
  document.getElementById('uploadProgress').style.display = 'block';
  document.getElementById('uploadProgressText').textContent = '正在上傳並呼叫 Claude AI 分析…';
  document.getElementById('dropZone').style.opacity = '0.5';
  document.getElementById('dropZone').style.pointerEvents = 'none';

  const formData = new FormData();
  formData.append('file', file);

  const endpoint = isPdf ? '/api/admin/import/preview/pdf' : '/api/admin/import/preview';

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`伺服器回應非 JSON (${res.status}): ${text.slice(0, 120)}`); }

    if (!res.ok) {
      showToast(data.error || '分析失敗', 'error');
      resetImportUI();
      return;
    }

    _importProducts = data.products;
    renderImportPreview(data);
  } catch (e) {
    showToast('上傳失敗：' + e.message, 'error');
    resetImportUI();
  }
}

function resetImportUI() {
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('dropZone').style.opacity = '1';
  document.getElementById('dropZone').style.pointerEvents = 'auto';
  document.getElementById('excelFileInput').value = '';
  document.getElementById('pdfFileInput').value = '';
}

function renderImportPreview(data) {
  resetImportUI();
  document.getElementById('importStep1').style.display = 'none';
  document.getElementById('importStep2').style.display = 'block';
  document.getElementById('importStep3').style.display = 'none';

  // Summary pills
  document.getElementById('importSummary').innerHTML = `
    <span class="summary-pill pill-total">共 ${data.total} 筆</span>
    <span class="summary-pill pill-new">新增 ${data.new_count}</span>
    <span class="summary-pill pill-update">更新 ${data.update_count}</span>
    ${data.error_count ? `<span class="summary-pill pill-error">錯誤 ${data.error_count}</span>` : ''}
  `;

  // Table rows
  const CATEGORY_LABELS = {
    base:'基礎配置', orientation:'檢體夾具固定裝置', clamping:'快速夾緊系統',
    holder:'檢體夾具', blade_base:'刀架底座', blade_holder:'刀架/刀片架',
    blade:'刀片（耗材）', cooling:'冷卻系統', lighting:'照明與觀察裝置', accessory:'其他配件',
  };
  const STATUS_MAP = {
    new:    '<span class="import-badge import-new">新增</span>',
    update: '<span class="import-badge import-update">更新</span>',
    error:  '<span class="import-badge import-error">錯誤</span>',
  };

  const tbody = document.getElementById('importPreviewBody');
  tbody.innerHTML = data.products.map((p, i) => `
    <tr style="${p._status === 'error' ? 'background:#FFF5F5' : ''}">
      <td>${STATUS_MAP[p._status] || p._status}</td>
      <td><code style="font-size:12px">${p.catalog_number || '—'}</code></td>
      <td>${p.name_zh || '—'}</td>
      <td>${CATEGORY_LABELS[p.category] || p.category || '—'}</td>
      <td class="text-right">${p.cost_price ? p.cost_price.toLocaleString() : '—'}</td>
      <td class="text-right">${p.min_sell_price ? p.min_sell_price.toLocaleString() : '—'}</td>
      <td class="text-right">${p.suggested_price ? p.suggested_price.toLocaleString() : '—'}</td>
      <td class="text-right">${p.retail_price ? p.retail_price.toLocaleString() : '—'}</td>
      <td style="color:#C0392B; font-size:12px">${(p._errors || []).join(', ')}</td>
    </tr>
  `).join('');

  // Disable confirm if all errors
  const hasValid = data.products.some(p => p._status !== 'error');
  document.getElementById('confirmImportBtn').disabled = !hasValid;
}

async function confirmImport() {
  const validProducts = _importProducts.filter(p => p._status !== 'error');
  if (!validProducts.length) { showToast('沒有可匯入的資料', 'error'); return; }

  const includePricing = document.getElementById('includePricing').checked;
  document.getElementById('confirmImportBtn').disabled = true;
  document.getElementById('confirmImportBtn').textContent = '匯入中…';

  try {
    const res = await apiFetch('/api/admin/import/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: validProducts, include_pricing: includePricing }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || '匯入失敗', 'error'); return; }

    document.getElementById('importStep2').style.display = 'none';
    document.getElementById('importStep3').style.display = 'block';
    document.getElementById('importResultMsg').textContent = `匯入完成！`;
    document.getElementById('importResultDetail').textContent =
      `新增 ${data.inserted} 筆，更新 ${data.updated} 筆`;
    showToast(`匯入完成：新增 ${data.inserted}、更新 ${data.updated}`);
  } catch (e) {
    showToast('匯入失敗：' + e.message, 'error');
    document.getElementById('confirmImportBtn').disabled = false;
    document.getElementById('confirmImportBtn').textContent = '✅ 確認匯入';
  }
}

// ── Approval Chain ────────────────────────────────────────────
async function loadChain() {
  const res = await apiFetch('/api/approvals/chain');
  if (!res || !res.ok) return;
  const chain = await res.json();

  const tbody = document.getElementById('chainBody');
  if (!chain.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">尚未設定審批人員，報價單提交後將由管理員直接核准</td></tr>';
    return;
  }
  tbody.innerHTML = chain.map(c => `
    <tr>
      <td style="text-align:center">${c.step_order}</td>
      <td><strong>${c.display_name}</strong></td>
      <td class="text-small text-muted">${c.username}</td>
      <td><span class="role-badge role-${c.role}">${ROLE_LABELS[c.role] || c.role}</span></td>
      <td class="text-small text-muted">${c.email || '—'}</td>
      <td>
        <button class="btn btn-outline btn-sm" style="color:#DC3545;border-color:#DC3545" onclick="removeChainMember(${c.id}, '${escapeJs(c.display_name)}')">移除</button>
      </td>
    </tr>
  `).join('');
}

async function openAddChainMember() {
  const res = await apiFetch('/api/approvals/eligible');
  if (!res || !res.ok) return;
  const users = await res.json();

  const sel = document.getElementById('chain_user_id');
  sel.innerHTML = '<option value="">— 選擇 —</option>' +
    users.map(u => `<option value="${u.id}">${u.display_name}（${ROLE_LABELS[u.role] || u.role}）</option>`).join('');
  document.getElementById('chain_order').value = '99';
  document.getElementById('chainModal').classList.add('open');
}

async function saveChainMember() {
  const userId = document.getElementById('chain_user_id').value;
  const order  = parseInt(document.getElementById('chain_order').value) || 99;
  if (!userId) { showToast('請選擇人員', 'error'); return; }

  const res = await apiFetch('/api/approvals/chain', {
    method: 'POST',
    body: JSON.stringify({ user_id: parseInt(userId), step_order: order }),
  });
  if (!res || !res.ok) {
    const err = await res?.json();
    showToast(err?.error || '新增失敗', 'error');
    return;
  }
  closeModal('chainModal');
  showToast('已加入審批鏈', 'success');
  loadChain();
}

async function removeChainMember(id, name) {
  if (!confirm(`確定移除「${name}」嗎？`)) return;
  const res = await apiFetch(`/api/approvals/chain/${id}`, { method: 'DELETE' });
  if (!res || !res.ok) { showToast('移除失敗', 'error'); return; }
  showToast('已移除', 'success');
  loadChain();
}

// ── BOM Management ────────────────────────────────────────────
let _currentBomId = null;
let _allProducts   = [];

async function loadBoms() {
  const res = await apiFetch('/api/admin/boms');
  if (!res || !res.ok) return;
  const boms = await res.json();

  const tbody = document.getElementById('bomBody');
  if (!boms.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted">尚無 BOM，請點右上角新增</td></tr>';
    return;
  }
  const categoryLabels = {
    digital_pathology: '數位病理',
    tissue_processor: '脫水機', embedding_center: '包埋機',
    microtome: '切片機（石蠟）', cryostat: '冷凍切片機', stainer: '染色機',
  };
  tbody.innerHTML = boms.map(b => `
    <tr>
      <td><strong>${b.name}</strong>${b.subcategory ? `<br><span class="text-small text-muted">${b.subcategory}</span>` : ''}</td>
      <td class="text-small" style="font-family:var(--font-mono);font-size:11px;color:#555">${categoryLabels[b.instrument_category] || '—'}</td>
      <td class="text-small text-muted">${b.description || '—'}</td>
      <td style="text-align:center">${b.item_count}</td>
      <td class="price-cost">${b.total_cost > 0 ? formatPrice(b.total_cost) : '—'}</td>
      <td class="price-suggest">${b.total_suggested > 0 ? formatPrice(b.total_suggested) : '—'}</td>
      <td>
        <span class="status-badge" style="background:${b.active ? '#D4EDDA':'#E2E3E5'}; color:${b.active ? '#155724':'#6C757D'}">
          ${b.active ? '可配置' : 'Coming Soon'}
        </span>
      </td>
      <td style="display:flex; gap:6px">
        <button class="btn btn-outline btn-sm" onclick="openBomDetail(${b.id}, '${escapeJs(b.name)}')">明細</button>
        <button class="btn btn-outline btn-sm" onclick="openEditBom(${b.id}, '${escapeJs(b.name)}', '${escapeJs(b.description||'')}', ${b.active}, '${b.instrument_category||''}', '${escapeJs(b.short_description||'')}', '${escapeJs(b.subcategory||'')}')">編輯</button>
        <button class="btn btn-outline btn-sm" style="color:#DC3545; border-color:#DC3545" onclick="deleteBom(${b.id}, '${escapeJs(b.name)}')">刪除</button>
      </td>
    </tr>
  `).join('');
}

function openAddBom() {
  document.getElementById('bom_id').value = '';
  document.getElementById('bom_name').value = '';
  document.getElementById('bom_desc').value = '';
  document.getElementById('bom_category').value = '';
  document.getElementById('bom_subcategory').value = '';
  document.getElementById('bom_active').value = '0';
  document.getElementById('bom_short_desc').value = '';
  document.getElementById('bomModalTitle').textContent = '新增 BOM';
  document.getElementById('bomModalSaveBtn').textContent = '新增';
  document.getElementById('bomModal').classList.add('open');
}

function openEditBom(id, name, desc, active, category = '', shortDesc = '', subcategory = '') {
  document.getElementById('bom_id').value = id;
  document.getElementById('bom_name').value = name;
  document.getElementById('bom_desc').value = desc;
  document.getElementById('bom_category').value = category;
  document.getElementById('bom_subcategory').value = subcategory;
  document.getElementById('bom_active').value = active ? '1' : '0';
  document.getElementById('bom_short_desc').value = shortDesc;
  document.getElementById('bomModalTitle').textContent = '編輯 BOM';
  document.getElementById('bomModalSaveBtn').textContent = '儲存';
  document.getElementById('bomModal').classList.add('open');
}

async function saveBom() {
  const id   = document.getElementById('bom_id').value;
  const name = document.getElementById('bom_name').value.trim();
  if (!name) { showToast('BOM 名稱為必填', 'error'); return; }

  const body = {
    name,
    description:          document.getElementById('bom_desc').value.trim(),
    instrument_category:  document.getElementById('bom_category').value,
    subcategory:          document.getElementById('bom_subcategory').value.trim(),
    short_description:    document.getElementById('bom_short_desc').value.trim(),
    active:               parseInt(document.getElementById('bom_active').value),
  };
  const res  = id
    ? await apiFetch(`/api/admin/boms/${id}`, { method: 'PUT', body: JSON.stringify(body) })
    : await apiFetch('/api/admin/boms', { method: 'POST', body: JSON.stringify(body) });

  if (!res || !res.ok) { showToast('儲存失敗', 'error'); return; }
  closeModal('bomModal');
  showToast(id ? 'BOM 已更新' : 'BOM 已建立', 'success');
  loadBoms();
}

async function deleteBom(id, name) {
  if (!confirm(`確定刪除「${name}」及其所有品項？`)) return;
  const res = await apiFetch(`/api/admin/boms/${id}`, { method: 'DELETE' });
  if (!res || !res.ok) { showToast('刪除失敗', 'error'); return; }
  showToast('已刪除', 'success');
  loadBoms();
}

async function openBomDetail(bomId, bomName) {
  _currentBomId = bomId;
  document.getElementById('bomDetailTitle').textContent = `BOM 明細：${bomName}`;
  document.getElementById('bomItemsBody').innerHTML = '<tr><td colspan="8" class="text-muted">載入中…</td></tr>';
  document.getElementById('bomDetailModal').classList.add('open');

  // 預載所有產品到下拉選單（只抓一次）
  if (!_allProducts.length) {
    const pr = await apiFetch('/api/admin/products');
    if (pr && pr.ok) _allProducts = await pr.json();
  }
  const sel = document.getElementById('bom_add_product');
  sel.innerHTML = '<option value="">— 選擇產品 —</option>' +
    _allProducts.filter(p => p.active).map(p =>
      `<option value="${p.id}">[${p.catalog_number}] ${p.name_zh}</option>`
    ).join('');

  await renderBomItems();
}

async function renderBomItems() {
  const res = await apiFetch(`/api/admin/boms/${_currentBomId}/items`);
  if (!res || !res.ok) return;
  const { items } = await res.json();

  const tbody = document.getElementById('bomItemsBody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-muted">尚無品項，請從上方選擇產品加入</td></tr>';
    document.getElementById('bomItemsFoot').innerHTML = '';
    return;
  }

  tbody.innerHTML = items.map(it => `
    <tr>
      <td class="text-small">${it.catalog_number}</td>
      <td>${it.name_zh}</td>
      <td style="text-align:center">
        <input type="number" value="${it.quantity}" min="1"
          style="width:60px; padding:4px 6px; border:1px solid #DDD; border-radius:4px; text-align:center"
          onchange="updateBomItemQty(${it.id}, this.value, '${escapeJs(it.notes||'')}')">
      </td>
      <td class="price-cost text-right">${it.cost_price > 0 ? formatPrice(it.cost_price) : '—'}</td>
      <td class="price-suggest text-right">${it.suggested_price > 0 ? formatPrice(it.suggested_price) : '—'}</td>
      <td class="price-suggest text-right">${it.suggested_price > 0 ? formatPrice(it.suggested_price * it.quantity) : '—'}</td>
      <td class="text-small text-muted">${it.notes || '—'}</td>
      <td style="text-align:center">
        <input type="checkbox" ${it.required ? 'checked' : ''}
          title="${it.required ? '強制選配（業務不可刪除）' : '非強制（業務可自行移除）'}"
          onchange="updateBomItemRequired(${it.id}, this.checked)"
          style="width:16px;height:16px;cursor:pointer">
      </td>
      <td>
        <button class="btn btn-outline btn-sm" style="color:#DC3545; border-color:#DC3545"
          onclick="removeBomItem(${it.id})">移除</button>
      </td>
    </tr>
  `).join('');

  const totalCost      = items.reduce((s, it) => s + (it.cost_price||0) * it.quantity, 0);
  const totalSuggested = items.reduce((s, it) => s + (it.suggested_price||0) * it.quantity, 0);
  document.getElementById('bomItemsFoot').innerHTML = `
    <tr style="font-weight:700; background:#F5F5F7">
      <td colspan="3" style="text-align:right">合計</td>
      <td class="price-cost text-right">${totalCost > 0 ? formatPrice(totalCost) : '—'}</td>
      <td class="price-suggest text-right"></td>
      <td class="price-suggest text-right">${totalSuggested > 0 ? formatPrice(totalSuggested) : '—'}</td>
      <td colspan="3"></td>
    </tr>
  `;
}

async function addBomItem() {
  const productId = document.getElementById('bom_add_product').value;
  const quantity  = parseInt(document.getElementById('bom_add_qty').value) || 1;
  const notes     = document.getElementById('bom_add_notes').value.trim();
  if (!productId) { showToast('請選擇產品', 'error'); return; }

  const required = document.getElementById('bom_add_required')?.checked ? 1 : 0;
  const res = await apiFetch(`/api/admin/boms/${_currentBomId}/items`, {
    method: 'POST',
    body: JSON.stringify({ product_id: productId, quantity, notes, required }),
  });
  if (!res || !res.ok) {
    const err = await res?.json();
    showToast(err?.error || '加入失敗', 'error');
    return;
  }
  document.getElementById('bom_add_product').value = '';
  document.getElementById('bom_add_qty').value = '1';
  document.getElementById('bom_add_notes').value = '';
  showToast('已加入', 'success');
  await renderBomItems();
}

async function updateBomItemQty(itemId, qty, notes) {
  await apiFetch(`/api/admin/boms/${_currentBomId}/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ quantity: parseInt(qty)||1, notes }),
  });
  await renderBomItems();
}

async function updateBomItemRequired(itemId, required) {
  await apiFetch(`/api/admin/boms/${_currentBomId}/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ required: required ? 1 : 0 }),
  });
  // 不需要重新渲染，checkbox 狀態已由使用者自行切換
}

async function removeBomItem(itemId) {
  const res = await apiFetch(`/api/admin/boms/${_currentBomId}/items/${itemId}`, { method: 'DELETE' });
  if (!res || !res.ok) { showToast('移除失敗', 'error'); return; }
  showToast('已移除', 'success');
  await renderBomItems();
}

function resetImport() {
  _importProducts = [];
  document.getElementById('importStep1').style.display = 'block';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep3').style.display = 'none';
  resetImportUI();
}

// ── Catalog Item Management ────────────────────────────────────
const CATALOG_CATEGORY_LABELS = {
  digital_pathology: '數位病理',
  tissue_processor: '脫水機', embedding_center: '包埋機',
  microtome: '切片機（石蠟）', cryostat: '冷凍切片機', stainer: '染色機',
};

async function loadCatalogItems() {
  const res = await apiFetch('/api/admin/catalog');
  if (!res || !res.ok) return;
  const items = await res.json();
  const tbody = document.getElementById('catalogBody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted">尚無項目</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(c => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td class="text-small">${CATALOG_CATEGORY_LABELS[c.instrument_category]||c.instrument_category}</td>
      <td class="text-small text-muted">${c.subcategory||'—'}</td>
      <td class="text-small text-muted">${c.short_description||'—'}</td>
      <td>
        <span class="status-badge" style="background:${c.status==='available'?'#D4EDDA':'#F0F0F0'}; color:${c.status==='available'?'#155724':'#666'}">
          ${c.status==='available'?'配置報價':'Coming Soon'}
        </span>
        ${!c.active ? '<span class="status-badge" style="background:#F8D7DA;color:#721C24;margin-left:4px">隱藏</span>' : ''}
      </td>
      <td style="display:flex; gap:6px">
        <button class="btn btn-outline btn-sm" onclick="openEditCatalogItem(${c.id},'${escapeJs(c.name)}','${c.instrument_category}','${escapeJs(c.subcategory||'')}','${escapeJs(c.short_description||'')}','${c.status}','${escapeJs(c.configurator_url||'')}',${c.sort_order},${c.active})">編輯</button>
        <button class="btn btn-outline btn-sm" style="color:#DC3545;border-color:#DC3545" onclick="deleteCatalogItem(${c.id},'${escapeJs(c.name)}')">刪除</button>
      </td>
    </tr>
  `).join('');
}

function openAddCatalogItem() {
  document.getElementById('cat_id').value = '';
  ['cat_name','cat_subcategory','cat_short_desc','cat_url'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cat_category').value = 'microtome';
  document.getElementById('cat_status').value = 'coming_soon';
  document.getElementById('cat_sort').value = '99';
  document.getElementById('catalogModalTitle').textContent = '新增目錄項目';
  document.getElementById('catalogModal').classList.add('open');
}

function openEditCatalogItem(id, name, category, subcategory, shortDesc, status, url, sort, active) {
  document.getElementById('cat_id').value = id;
  document.getElementById('cat_name').value = name;
  document.getElementById('cat_category').value = category;
  document.getElementById('cat_subcategory').value = subcategory;
  document.getElementById('cat_short_desc').value = shortDesc;
  document.getElementById('cat_status').value = status;
  document.getElementById('cat_url').value = url;
  document.getElementById('cat_sort').value = sort;
  document.getElementById('catalogModalTitle').textContent = '編輯目錄項目';
  document.getElementById('catalogModal').classList.add('open');
}

async function saveCatalogItem() {
  const id = document.getElementById('cat_id').value;
  const name = document.getElementById('cat_name').value.trim();
  const instrument_category = document.getElementById('cat_category').value;
  if (!name || !instrument_category) { showToast('名稱與類別為必填', 'error'); return; }
  const body = {
    name,
    instrument_category,
    subcategory:       document.getElementById('cat_subcategory').value.trim(),
    short_description: document.getElementById('cat_short_desc').value.trim(),
    status:            document.getElementById('cat_status').value,
    configurator_url:  document.getElementById('cat_url').value.trim(),
    sort_order:        parseInt(document.getElementById('cat_sort').value)||99,
    active: 1,
  };
  const res = id
    ? await apiFetch(`/api/admin/catalog/${id}`, { method:'PUT', body: JSON.stringify(body) })
    : await apiFetch('/api/admin/catalog', { method:'POST', body: JSON.stringify(body) });
  if (!res || !res.ok) { showToast('儲存失敗', 'error'); return; }
  closeModal('catalogModal');
  showToast(id ? '已更新' : '已新增', 'success');
  loadCatalogItems();
}

async function deleteCatalogItem(id, name) {
  if (!confirm(`確定刪除「${name}」？`)) return;
  const res = await apiFetch(`/api/admin/catalog/${id}`, { method:'DELETE' });
  if (!res || !res.ok) { showToast('刪除失敗','error'); return; }
  showToast('已刪除','success');
  loadCatalogItems();
}

// ── Role Permissions ──────────────────────────────────────────
const RP_FIELDS = [
  { key: 'import_products',  label: '匯入產品' },
  { key: 'manage_approval',  label: '修改審批順序' },
  { key: 'manage_bom',       label: 'BOM 管理' },
  { key: 'manage_users',     label: '用戶管理' },
  { key: 'manage_products',  label: '產品管理' },
  { key: 'manage_pricing',   label: '定價管理' },
  { key: 'manage_quotes',    label: '報價管理' },
];

async function loadRolePermissions() {
  const res = await apiFetch('/api/admin/role-permissions');
  if (!res || !res.ok) return;
  const rows = await res.json();

  const tbody = document.getElementById('rolePermsBody');
  tbody.innerHTML = rows.map(r => {
    const checkboxes = RP_FIELDS.map(f =>
      `<td style="text-align:center">
        <input type="checkbox" ${r[f.key] ? 'checked' : ''}
          id="rp_${r.role}_${f.key}" style="width:16px;height:16px;cursor:pointer">
      </td>`
    ).join('');
    return `<tr>
      <td><span class="role-badge role-${r.role}">${ROLE_LABELS[r.role] || r.role}</span></td>
      ${checkboxes}
      <td><button class="btn btn-outline btn-sm" onclick="saveRolePermissions('${r.role}')">儲存</button></td>
    </tr>`;
  }).join('');
}

async function saveRolePermissions(role) {
  const body = {};
  RP_FIELDS.forEach(f => {
    body[f.key] = document.getElementById(`rp_${role}_${f.key}`)?.checked ? 1 : 0;
  });
  const res = await apiFetch(`/api/admin/role-permissions/${role}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) { showToast('儲存失敗', 'error'); return; }
  showToast(`${ROLE_LABELS[role] || role} 權限已更新`, 'success');
}

// ── API Settings (super_admin only) ───────────────────────────
const API_KEY_LABELS = {
  openai_api_key:    'OpenAI API Key',
  gemini_api_key:    'Google Gemini API Key',
  anthropic_api_key: 'Anthropic Claude API Key',
};

// ── Customer Management ───────────────────────────────────────
let _allCustomers = [];

async function loadCustomers() {
  const res = await apiFetch('/api/customers');
  if (!res || !res.ok) return;
  _allCustomers = await res.json();
  renderCustomers(_allCustomers);
}

function filterCustomers(q) {
  if (!q.trim()) return renderCustomers(_allCustomers);
  const lq = q.toLowerCase();
  renderCustomers(_allCustomers.filter(c =>
    (c.name||'').toLowerCase().includes(lq) ||
    (c.org||'').toLowerCase().includes(lq) ||
    (c.phone||'').includes(lq) ||
    (c.email||'').toLowerCase().includes(lq)
  ));
}

function renderCustomers(list) {
  const tbody = document.getElementById('customersBody');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(c => `
    <tr>
      <td>${esc(c.name)}</td>
      <td>${esc(c.org||'—')}</td>
      <td>${esc(c.phone||'—')}</td>
      <td>${esc(c.email||'—')}</td>
      <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(c.notes||'')}</td>
      <td style="text-align:center; white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="openCustomerModal(${c.id})">編輯</button>
        <button class="btn btn-sm" style="background:#FEE2E2;color:#C0392B;border:1px solid #FAD;margin-left:4px"
          onclick="deleteCustomer(${c.id}, '${esc(c.name)}')">刪除</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="6" style="text-align:center;color:#999;padding:24px">尚無客戶資料</td></tr>';
}

function openCustomerModal(id) {
  const c = id ? _allCustomers.find(x => x.id === id) : null;
  document.getElementById('customerModalTitle').textContent = c ? '編輯客戶' : '新增客戶';
  document.getElementById('cModalId').value      = c?.id || '';
  document.getElementById('cModalName').value    = c?.name || '';
  document.getElementById('cModalOrg').value     = c?.org || '';
  document.getElementById('cModalPhone').value   = c?.phone || '';
  document.getElementById('cModalEmail').value   = c?.email || '';
  document.getElementById('cModalAddress').value = c?.address || '';
  document.getElementById('cModalNotes').value   = c?.notes || '';
  document.getElementById('customerModal').style.display = 'flex';
}

function closeCustomerModal() {
  document.getElementById('customerModal').style.display = 'none';
}

async function saveCustomer() {
  const id = document.getElementById('cModalId').value;
  const body = {
    name:    document.getElementById('cModalName').value.trim(),
    org:     document.getElementById('cModalOrg').value.trim(),
    phone:   document.getElementById('cModalPhone').value.trim(),
    email:   document.getElementById('cModalEmail').value.trim(),
    address: document.getElementById('cModalAddress').value.trim(),
    notes:   document.getElementById('cModalNotes').value.trim(),
  };
  if (!body.name) { showToast('請填寫客戶姓名', 'error'); return; }

  const url    = id ? `/api/customers/${id}` : '/api/customers';
  const method = id ? 'PUT' : 'POST';
  const res = await apiFetch(url, { method, body: JSON.stringify(body) });
  if (!res || !res.ok) { showToast('儲存失敗', 'error'); return; }

  showToast(id ? '客戶已更新' : '客戶已新增', 'success');
  closeCustomerModal();
  loadCustomers();
}

async function deleteCustomer(id, name) {
  if (!confirm(`確定要刪除客戶「${name}」嗎？`)) return;
  const res = await apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
  if (!res || !res.ok) { showToast('刪除失敗', 'error'); return; }
  showToast('已刪除', 'success');
  loadCustomers();
}

async function loadApiSettings() {
  const res = await apiFetch('/api/admin/api-settings');
  if (!res || !res.ok) { showToast('載入失敗', 'error'); return; }
  const rows = await res.json();
  const container = document.getElementById('apiSettingsBody');
  if (!container) return;
  container.innerHTML = rows.map(r => {
    const label = API_KEY_LABELS[r.key] || r.key;
    const maskedVal = r.value ? '●'.repeat(Math.min(r.value.length, 20)) : '';
    const updatedAt = r.updated_at ? r.updated_at.slice(0,16).replace('T',' ') : '—';
    return `
    <tr>
      <td><strong>${label}</strong><br><span class="text-small text-muted">${r.key}</span></td>
      <td>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="password" id="apikey_${r.key}"
            value="${escapeHtml(r.value||'')}"
            placeholder="${maskedVal || '（未設定）'}"
            style="flex:1;font-family:monospace;font-size:12px"
            autocomplete="new-password">
          <button class="btn btn-sm" onclick="toggleApiKeyVisibility('apikey_${r.key}', this)">👁</button>
        </div>
      </td>
      <td class="text-small text-muted">${updatedAt}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="saveApiSetting('${r.key}')">儲存</button>
      </td>
    </tr>`;
  }).join('');
}

function toggleApiKeyVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function saveApiSetting(key) {
  const input = document.getElementById(`apikey_${key}`);
  if (!input) return;
  const res = await apiFetch(`/api/admin/api-settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value: input.value }),
  });
  if (!res || !res.ok) { showToast('儲存失敗', 'error'); return; }
  showToast('已儲存', 'success');
  loadApiSettings();
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Export Excel ──────────────────────────────────────────────
async function exportProductsExcel() {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/admin/export/products', {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) { showToast('匯出失敗', 'error'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `products_${new Date().toISOString().slice(0,10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Product Dependencies ───────────────────────────────────────
let _depProductId = null;

async function openDepModal(productId, productName) {
  _depProductId = productId;
  document.getElementById('depModalTitle').textContent = `產品關聯：${productName}`;

  // 預載所有產品到下拉（排除自身）
  if (!_allProducts.length) {
    const pr = await apiFetch('/api/admin/products');
    if (pr && pr.ok) _allProducts = await pr.json();
  }
  document.getElementById('dep_product_select').innerHTML =
    '<option value="">— 選擇產品 —</option>' +
    _allProducts.filter(p => p.active && p.id !== productId).map(p =>
      `<option value="${p.id}">[${p.catalog_number}] ${p.name_zh}</option>`
    ).join('');

  document.getElementById('depModal').classList.add('open');
  await renderDeps();
}

async function renderDeps() {
  const res = await apiFetch(`/api/admin/products/${_depProductId}/dependencies`);
  if (!res || !res.ok) return;
  const rows = await res.json();
  const tbody = document.getElementById('depBody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">尚無關聯</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td class="text-small">${r.catalog_number}</td>
      <td>${r.name_zh}</td>
      <td style="text-align:center">${r.quantity}</td>
      <td><button class="btn btn-outline btn-sm" style="color:#DC3545;border-color:#DC3545" onclick="removeDependency(${r.id})">移除</button></td>
    </tr>
  `).join('');
}

async function addDependency() {
  const reqId = document.getElementById('dep_product_select').value;
  const qty   = parseInt(document.getElementById('dep_qty').value) || 1;
  if (!reqId) { showToast('請選擇關聯產品', 'error'); return; }
  const res = await apiFetch(`/api/admin/products/${_depProductId}/dependencies`, {
    method: 'POST',
    body: JSON.stringify({ requires_product_id: reqId, quantity: qty }),
  });
  if (!res || !res.ok) {
    const err = await res?.json();
    showToast(err?.error || '加入失敗', 'error');
    return;
  }
  document.getElementById('dep_product_select').value = '';
  document.getElementById('dep_qty').value = '1';
  showToast('已加入關聯', 'success');
  await renderDeps();
}

async function removeDependency(depId) {
  const res = await apiFetch(`/api/admin/products/${_depProductId}/dependencies/${depId}`, { method: 'DELETE' });
  if (!res || !res.ok) { showToast('移除失敗', 'error'); return; }
  showToast('已移除', 'success');
  await renderDeps();
}
