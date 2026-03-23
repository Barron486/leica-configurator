// ── Init ──────────────────────────────────────────────────────
const REVIEWER_ROLES = ['admin', 'finance', 'management', 'gm'];
const ADMIN_ONLY_ROLES = ['admin'];

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

  // 非 admin 隱藏管理類 tabs
  if (!ADMIN_ONLY_ROLES.includes(user.role)) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const tab = btn.getAttribute('onclick')?.match(/switchTab\('(\w+)'\)/)?.[1];
      if (['pricing', 'products', 'users'].includes(tab)) btn.style.display = 'none';
    });
  }

  loadQuotes();
})();

// ── Tab Switching ─────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  event.currentTarget.classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');

  if (name === 'quotes')   loadQuotes();
  if (name === 'pricing')  loadPricing();
  if (name === 'products') loadProducts();
  if (name === 'users')    loadUsers();
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
    notesInput.placeholder = '備註（可選）';
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

  document.getElementById('quoteDetailModal').classList.add('open');
}

async function reviewQuote(id, action) {
  const notes = document.getElementById('adminNotes')?.value || '';
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
      <td>
        <span class="status-badge" style="background:${p.active ? '#D4EDDA' : '#F8D7DA'}; color:${p.active ? '#155724' : '#721C24'}">
          ${p.active ? '啟用' : '停用'}
        </span>
      </td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="toggleProduct(${p.id}, ${p.active})">
          ${p.active ? '停用' : '啟用'}
        </button>
      </td>
    </tr>
  `).join('');
}

function openAddProduct() {
  ['np_code','np_name_zh','np_name_en','np_desc','np_notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('np_sort').value = '99';
  document.getElementById('np_category').value = 'accessory';
  document.getElementById('productModal').classList.add('open');
}

async function saveProduct() {
  const code = document.getElementById('np_code').value.trim();
  const name = document.getElementById('np_name_zh').value.trim();
  if (!code || !name) { showToast('料號和中文名稱為必填', 'error'); return; }

  const body = {
    catalog_number: code,
    name_zh: name,
    name_en: document.getElementById('np_name_en').value.trim(),
    category: document.getElementById('np_category').value,
    description: document.getElementById('np_desc').value.trim(),
    notes: document.getElementById('np_notes').value.trim(),
    sort_order: parseInt(document.getElementById('np_sort').value) || 99,
  };

  const res = await apiFetch('/api/admin/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) {
    const err = await res?.json();
    showToast(err?.error || '新增失敗', 'error');
    return;
  }
  closeModal('productModal');
  showToast('產品已新增', 'success');
  loadProducts();
}

async function toggleProduct(id, currentActive) {
  const res = await apiFetch(`/api/admin/products/${id}`, {
    method: 'PUT',
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
      <td class="text-small text-muted">${formatDate(u.created_at)}</td>
      <td><button class="btn btn-outline btn-sm" onclick="openEditUser(${u.id}, '${escapeJs(u.username)}', '${u.role}', '${escapeJs(u.display_name||'')}', '${escapeJs(u.email||'')}')">編輯</button></td>
    </tr>
  `).join('');
}

function openAddUser() {
  document.getElementById('userModalTitle').textContent = '新增用戶';
  document.getElementById('user_id').value = '';
  document.getElementById('pwdHint').style.display = 'none';
  ['u_username','u_password','u_display','u_email'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('u_role').value = 'sales';
  document.getElementById('userModal').classList.add('open');
}

function openEditUser(id, username, role, display, email) {
  document.getElementById('userModalTitle').textContent = '編輯用戶';
  document.getElementById('user_id').value = id;
  document.getElementById('u_username').value = username;
  document.getElementById('u_password').value = '';
  document.getElementById('u_role').value = role;
  document.getElementById('u_display').value = display;
  document.getElementById('u_email').value = email;
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
  if (!file.name.match(/\.xlsx?$/i)) {
    showToast('請選擇 .xlsx 或 .xls 檔案', 'error');
    return;
  }

  // Show progress
  document.getElementById('uploadProgress').style.display = 'block';
  document.getElementById('uploadProgressText').textContent = '正在上傳並呼叫 Claude AI 分析…';
  document.getElementById('dropZone').style.opacity = '0.5';
  document.getElementById('dropZone').style.pointerEvents = 'none';

  const formData = new FormData();
  formData.append('file', file);

  try {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/admin/import/preview', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData,
    });

    const data = await res.json();
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

function resetImport() {
  _importProducts = [];
  document.getElementById('importStep1').style.display = 'block';
  document.getElementById('importStep2').style.display = 'none';
  document.getElementById('importStep3').style.display = 'none';
  resetImportUI();
}
