// ── HTML escape ──────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── State ─────────────────────────────────────────────────────
let user = null;
let products = [];
let customPrices = new Map(); // id → manually entered price
let baseProduct  = null;
let _lastQuoteNumber = '';
let _editingQuoteId  = null; // 編輯草稿時的報價單 ID
let extraSelected    = new Map(); // product_id → quantity (購物車)
let customItems      = [];         // [{id, name, catalogNumber, cost, price, quantity}]
let _nextCid         = 1;
let autoDeps         = new Map();  // product_id → quantity（依賴自動帶入）
let _cartSearch      = '';
let _cartCatFilter   = '';

// ── Price helpers ─────────────────────────────────────────────
function getPriceKey() {
  return user.role === 'customer' ? 'retail_price' : 'suggested_price';
}

function getEffectivePrice(p) {
  if (customPrices.has(p.id)) return customPrices.get(p.id);
  return p[getPriceKey()] || 0;
}

function setCustomPrice(id, value) {
  const num = Math.round(parseFloat(value));
  if (!isNaN(num) && num > 0) {
    customPrices.set(id, num);
  } else {
    customPrices.delete(id);
  }
  renderSummary();
}

// 報價單內直接編輯單價 — 不重繪整張報價單，只更新小計與合計
function updateInvoicePrice(id, qty, inputEl) {
  const num = Math.round(parseFloat(inputEl.value));
  if (!isNaN(num) && num > 0) {
    customPrices.set(id, num);
    const sub = document.getElementById(`invoice-sub-${id}`);
    if (sub) sub.textContent = formatPrice(num * qty);
  } else {
    customPrices.delete(id);
    const sub = document.getElementById(`invoice-sub-${id}`);
    if (sub) sub.textContent = '';
  }
  _refreshInvoiceTotal();
  renderSummary();
}

function _refreshInvoiceTotal() {
  const allDbItems = [
    ...products.filter(p => extraSelected.has(p.id)),
    ...products.filter(p => autoDeps.has(p.id)),
  ];
  const dbTotal = allDbItems.reduce((s, p) => {
    const qty = extraSelected.has(p.id) ? extraSelected.get(p.id) : autoDeps.get(p.id);
    return s + getEffectivePrice(p) * (qty || 1);
  }, 0);
  const customTotal = customItems.reduce((s, ci) => s + ci.price * ci.quantity, 0);
  const total   = dbTotal + customTotal;
  const allFree = total === 0;
  const el = document.getElementById('invoice-total-amount');
  if (el) el.textContent = allFree ? '請洽業務' : formatPrice(total);
}

// ── Init ──────────────────────────────────────────────────────
(async function init() {
  user = requireAuth();
  if (!user) return;

  // Header
  document.getElementById('userName').textContent = user.display_name;
  const badge = document.getElementById('roleBadge');
  badge.textContent = { admin: '管理員', sales: '業務', customer: '客戶' }[user.role] || user.role;
  badge.className = `role-badge role-${user.role}`;

  // Admin link
  if (['admin','super_admin'].includes(user.role)) document.getElementById('adminLink').style.display = 'block';

  // 我的報價單連結（非 customer/demo）
  const mqLink = document.getElementById('myQuotesLink');
  if (mqLink && !['customer','demo'].includes(user.role)) mqLink.style.display = 'block';

  loadNotifications();

  // Role alert
  const alert = document.getElementById('roleAlert');
  if (user.role === 'sales') {
    alert.className = 'alert alert-info';
    alert.textContent = '業務模式：您可看到建議報價與最低售價。';
    alert.style.display = 'block';
  } else if (user.role === 'admin') {
    alert.className = 'alert alert-warn';
    alert.textContent = '管理員模式：您可看到所有價格（含成本）。';
    alert.style.display = 'block';
  } else {
    alert.className = 'alert';
    alert.style.background = '#D4EDDA'; alert.style.color = '#155724';
    alert.textContent = '歡迎！以下為建議零售價格。';
    alert.style.display = 'block';
  }

  // Load products
  const res = await apiFetch('/api/products');
  if (!res || !res.ok) return;
  products = await res.json();
  baseProduct = products.find(p => p.is_base_unit);

  const params = new URLSearchParams(location.search);
  const bomId  = params.get('bom');
  const editId = params.get('edit');

  if (editId) {
    // ── 編輯草稿模式 ──────────────────────────────────────────
    const qRes = await apiFetch(`/api/quotes/${editId}`);
    if (!qRes || !qRes.ok) {
      document.getElementById('productList').innerHTML =
        '<div style="text-align:center;padding:40px;color:#888">載入草稿失敗</div>';
      return;
    }
    const draft = await qRes.json();
    if (draft.status !== 'draft') {
      document.getElementById('productList').innerHTML =
        '<div style="text-align:center;padding:40px;color:#888">此報價單不是草稿，無法編輯</div>';
      return;
    }

    _editingQuoteId = draft.id;

    // 還原客戶資料
    document.getElementById('cust_name').value  = draft.customer_name  || '';
    document.getElementById('cust_org').value   = draft.customer_org   || '';
    document.getElementById('cust_phone').value = draft.customer_phone || '';
    document.getElementById('cust_email').value = draft.customer_email || '';
    const caseEl = document.getElementById('case_notes');
    if (caseEl) caseEl.value = draft.case_notes || '';

    // 還原品項
    draft.items.forEach(it => {
      if (it.product_id) {
        extraSelected.set(it.product_id, it.quantity);
        if (it.unit_price_snapshot != null) customPrices.set(it.product_id, it.unit_price_snapshot);
      } else {
        customItems.push({
          id:            _nextCid++,
          name:          it.custom_item_name || it.name_zh || '',
          catalogNumber: it.custom_catalog_number || '',
          cost:          0,
          price:         it.unit_price_snapshot || 0,
          quantity:      it.quantity || 1,
        });
      }
    });

    // 頁首提示
    const titleEl = document.querySelector('.main-topbar-title');
    if (titleEl) titleEl.textContent = `編輯草稿：${draft.quote_number}`;

    computeAutoDeps();
    renderProducts();
    renderSummary();
    return;
  }

  // ── 從 BOM 載入模式 ───────────────────────────────────────
  if (bomId) {
    const bomRes = await apiFetch(`/api/admin/boms/${bomId}/config`);
    if (bomRes && bomRes.ok) {
      const { bom, items } = await bomRes.json();
      items.forEach(item => {
        extraSelected.set(item.product_id, item.quantity);
      });
      const titleEl = document.querySelector('.main-topbar-title');
      if (titleEl && bom.name) titleEl.textContent = bom.name;
    }
  }

  // ── 一般模式（含無 bom param）：顯示所有產品目錄 ──────────
  computeAutoDeps();
  renderProducts();
  renderSummary();
})();

// CATEGORY_LABELS is defined in auth.js (shared)

// ── Render product list（購物車目錄模式）────────────────────────
function renderProducts() {
  computeAutoDeps();
  const container = document.getElementById('productList');

  const categoryOrder = ['base','orientation','clamping','holder','blade_base','blade_holder','blade','cooling','lighting','accessory'];

  // 搜尋 / 類別過濾
  const search = _cartSearch.trim().toLowerCase();
  const catFilter = _cartCatFilter;

  let filteredProducts = products.filter(p => {
    if (catFilter && p.category !== catFilter) return false;
    if (search) {
      const haystack = [p.name_zh, p.catalog_number, p.name_en].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // 頂部：搜尋列 + 類別過濾
  const catOptions = categoryOrder.map(c =>
    `<option value="${c}" ${catFilter === c ? 'selected' : ''}>${CATEGORY_LABELS[c] || c}</option>`
  ).join('');

  let html = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
      <input
        id="cartSearch"
        type="text"
        placeholder="搜尋品名、料號…"
        value="${escHtml(_cartSearch)}"
        oninput="_cartSearch=this.value; renderProducts()"
        style="flex:1;min-width:160px;padding:7px 10px;border:1px solid #DDD;border-radius:6px;font-size:13px"
      >
      <select
        id="catFilter"
        onchange="_cartCatFilter=this.value; renderProducts()"
        style="padding:7px 10px;border:1px solid #DDD;border-radius:6px;font-size:13px;background:#FFF"
      >
        <option value="" ${!catFilter ? 'selected' : ''}>全部類別</option>
        ${catOptions}
      </select>
    </div>`;

  // 依 categoryOrder 分組顯示
  const grouped = {};
  filteredProducts.forEach(p => {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  });

  let anyProduct = false;
  for (const cat of categoryOrder) {
    const items = grouped[cat];
    if (!items || items.length === 0) continue;
    anyProduct = true;
    items.sort((a, b) => a.sort_order - b.sort_order);

    html += `<div class="category-section"><div class="category-title">${CATEGORY_LABELS[cat] || cat}</div>`;

    for (const p of items) {
      const inCart   = extraSelected.has(p.id);
      const isAutoDep = autoDeps.has(p.id) && !inCart;

      if (isAutoDep) {
        // 自動帶入品項
        const qty = autoDeps.get(p.id);
        html += `<div class="product-item selected" style="opacity:0.85;background:#F0F4FF">
          <div class="product-info">
            <div class="product-name">${escHtml(p.name_zh)} <span style="color:#5B8DEF;font-size:10px;font-weight:600">⬡ 自動帶入</span></div>
            <div class="product-code">${escHtml(p.catalog_number)}</div>
            ${p.description ? `<div class="product-desc">${escHtml(p.description)}</div>` : ''}
          </div>
          <div class="product-price">
            ${renderPriceColumn(p)}
            <div class="qty-stepper" onclick="event.stopPropagation()">
              <button class="qty-btn" disabled style="opacity:0.4">−</button>
              <span class="qty-val">${qty}</span>
              <button class="qty-btn" disabled style="opacity:0.4">+</button>
            </div>
          </div>
        </div>`;
      } else if (inCart) {
        // 已在購物車
        const qty = extraSelected.get(p.id) || 1;
        html += `<div class="product-item selected">
          <div class="product-info">
            <div class="product-name">${escHtml(p.name_zh)}</div>
            <div class="product-code">${escHtml(p.catalog_number)}</div>
          </div>
          <div class="product-price">
            ${renderPriceColumn(p)}
            <div class="qty-stepper" onclick="event.stopPropagation()">
              <button class="qty-btn" onclick="changeCartQty(${p.id}, -1)">−</button>
              <span class="qty-val">${qty}</span>
              <button class="qty-btn" onclick="changeCartQty(${p.id}, 1)">+</button>
            </div>
            <button class="btn btn-outline btn-sm" style="margin-top:6px;color:#DC3545;border-color:#DC3545;font-size:11px" onclick="removeFromCart(${p.id})">移除</button>
          </div>
        </div>`;
      } else {
        // 未加入購物車
        html += `<div class="product-item">
          <div class="product-info">
            <div class="product-name">${escHtml(p.name_zh)}</div>
            <div class="product-code">${escHtml(p.catalog_number)}</div>
            ${p.description ? `<div class="product-desc">${escHtml(p.description)}</div>` : ''}
            ${p.notes ? `<div class="product-note">⚠ ${escHtml(p.notes)}</div>` : ''}
          </div>
          <div class="product-price">
            ${renderPriceColumn(p)}
            <button class="btn btn-outline btn-sm" style="margin-top:6px;white-space:nowrap" onclick="addToCart(${p.id})">＋ 加入購物車</button>
          </div>
        </div>`;
      }
    }

    html += `</div>`;
  }

  if (!anyProduct) {
    html += `<div style="text-align:center;padding:40px;color:#AAA;font-size:13px">找不到符合條件的產品</div>`;
  }

  // 自訂品項 section
  if (customItems.length > 0) {
    html += `<div class="category-section"><div class="category-title" style="display:flex;justify-content:space-between;align-items:center"><span>自訂品項</span><span style="font-size:10px;font-weight:400;color:#AAA">可移除</span></div>`;
    for (const ci of customItems) {
      html += `<div class="product-item selected">
        <div class="product-info">
          <div class="product-name">${escHtml(ci.name)}</div>
          <div class="product-code">${escHtml(ci.catalogNumber || '—')}</div>
        </div>
        <div class="product-price">
          ${user.role !== 'customer' && user.role !== 'demo' && ci.cost > 0 ? `<div class="price-cost">成本 ${formatPrice(ci.cost)}</div>` : ''}
          <div class="price-suggest">${ci.price > 0 ? formatPrice(ci.price) : '洽詢'}</div>
          <div class="qty-stepper" onclick="event.stopPropagation()">
            <button class="qty-btn" onclick="changeCustomQty(${ci.id}, -1)">−</button>
            <span class="qty-val">${ci.quantity}</span>
            <button class="qty-btn" onclick="changeCustomQty(${ci.id}, 1)">+</button>
          </div>
          <button class="btn btn-outline btn-sm" style="margin-top:6px;color:#DC3545;border-color:#DC3545;font-size:11px" onclick="removeCustomItem(${ci.id})">移除</button>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  // 手動新增自訂品項表單（一直顯示）
  html += _renderCustomItemForm();

  container.innerHTML = html;
}

function _renderCustomItemForm() {
  const canSeeCost = user.role !== 'customer' && user.role !== 'demo';
  const inp = 'padding:7px 8px; border:1px solid #DDD; border-radius:4px; font-size:13px';
  return `
    <div style="margin-top:20px; border-top:2px dashed #E5E5EA; padding-top:16px">
      <div style="font-size:12px;font-weight:700;color:#444;margin-bottom:14px">＋ 手動新增自訂品項</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px">
        <input id="customItemName" placeholder="品名 *" style="${inp};grid-column:1/-1">
        <input id="customItemCatalog" placeholder="料號（選填）" style="${inp}">
        <input id="customItemQty" type="number" value="1" min="1" max="99" placeholder="數量" style="${inp}">
        ${canSeeCost ? `<input id="customItemCost" type="number" min="0" step="1" placeholder="成本 *" style="${inp}">` : '<div></div>'}
        <input id="customItemPrice" type="number" min="0" step="1" placeholder="報價單價 *" style="${inp}">
      </div>
      <button class="btn btn-outline btn-sm" onclick="addCustomItem()">+ 新增自訂品項</button>
    </div>`;
}

function renderPriceColumn(p) {
  const currency = p.currency || 'TWD';
  const fmt = (v) => (v && v > 0) ? formatPrice(v, currency) : '';

  if (user.role === 'admin') {
    return `
      ${p.retail_price    > 0 ? `<div class="price-label">零售</div><div class="price-retail">${fmt(p.retail_price)}</div>` : ''}
      ${p.suggested_price > 0 ? `<div class="price-label">建議</div><div class="price-suggest">${fmt(p.suggested_price)}</div>` : ''}
      ${p.min_sell_price  > 0 ? `<div class="price-min">最低 ${fmt(p.min_sell_price)}</div>` : ''}
      ${p.cost_price      > 0 ? `<div class="price-cost">成本 ${fmt(p.cost_price)}</div>` : ''}
    `;
  } else if (user.role === 'sales') {
    return `
      ${p.suggested_price > 0 ? `<div class="price-label">建議報價</div><div class="price-suggest">${fmt(p.suggested_price)}</div>` : ''}
      ${p.min_sell_price  > 0 ? `<div class="price-min">最低 ${fmt(p.min_sell_price)}</div>` : ''}
      ${p.retail_price    > 0 ? `<div class="price-label">零售</div><div class="price-retail">${fmt(p.retail_price)}</div>` : ''}
    `;
  } else {
    return p.retail_price > 0
      ? `<div class="price-retail" style="font-size:14px">${fmt(p.retail_price)}</div>`
      : '';
  }
}

// ── 依賴解析 ──────────────────────────────────────────────────
function computeAutoDeps() {
  autoDeps = new Map();
  const allSelected = [...extraSelected.keys()];
  for (const id of allSelected) {
    const p = products.find(x => x.id === id);
    if (!p?.dependencies?.length) continue;
    for (const dep of p.dependencies) {
      const rid = dep.requires_product_id;
      if (extraSelected.has(rid)) continue; // 已在購物車中
      autoDeps.set(rid, Math.max(autoDeps.get(rid) || 0, dep.quantity));
    }
  }
}

// ── 購物車操作 ───────────────────────────────────────────────
function addToCart(id) {
  extraSelected.set(id, 1);
  renderProducts();
  renderSummary();
}

function removeFromCart(id) {
  extraSelected.delete(id);
  renderProducts();
  renderSummary();
}

function changeCartQty(id, delta) {
  if (!extraSelected.has(id)) return;
  const newQty = (extraSelected.get(id) || 1) + delta;
  if (newQty <= 0) {
    extraSelected.delete(id);
  } else if (newQty <= 99) {
    extraSelected.set(id, newQty);
  }
  renderProducts();
  renderSummary();
}

// ── Custom items ──────────────────────────────────────────────
function addCustomItem() {
  const nameEl  = document.getElementById('customItemName');
  const catEl   = document.getElementById('customItemCatalog');
  const priceEl = document.getElementById('customItemPrice');
  const costEl  = document.getElementById('customItemCost');
  const qtyEl   = document.getElementById('customItemQty');

  const name  = nameEl?.value.trim();
  const price = parseFloat(priceEl?.value);
  if (!name)              { showToast('請填寫品名', 'error'); return; }
  if (isNaN(price) || price < 0) { showToast('請填寫報價單價', 'error'); return; }

  const canSeeCost = user.role !== 'customer' && user.role !== 'demo';
  if (canSeeCost) {
    const cost = parseFloat(costEl?.value);
    if (isNaN(cost) || cost < 0) { showToast('請填寫成本', 'error'); return; }
  }

  customItems.push({
    id:           _nextCid++,
    name,
    catalogNumber: catEl?.value.trim() || '',
    cost:          parseFloat(costEl?.value) || 0,
    price,
    quantity:      parseInt(qtyEl?.value) || 1,
  });

  if (nameEl)  nameEl.value  = '';
  if (catEl)   catEl.value   = '';
  if (priceEl) priceEl.value = '';
  if (costEl)  costEl.value  = '';
  if (qtyEl)   qtyEl.value   = '1';

  renderProducts();
  renderSummary();
}

function removeCustomItem(id) {
  customItems = customItems.filter(ci => ci.id !== id);
  renderProducts();
  renderSummary();
}

function changeCustomQty(id, delta) {
  const ci = customItems.find(x => x.id === id);
  if (!ci) return;
  const newQty = ci.quantity + delta;
  if (newQty < 1) {
    customItems = customItems.filter(x => x.id !== id);
  } else if (newQty <= 99) {
    ci.quantity = newQty;
  }
  renderProducts();
  renderSummary();
}

// ── Render summary ────────────────────────────────────────────
function renderSummary() {
  const allDbItems = products.filter(p => extraSelected.has(p.id));
  const hasItems   = allDbItems.length > 0 || customItems.length > 0;

  const tbody      = document.getElementById('summaryItems');
  const priceBlock = document.getElementById('priceBlock');
  const btnSubmit  = document.getElementById('btnSubmit');
  const btnPreview = document.getElementById('btnPreview');

  if (!hasItems) {
    tbody.innerHTML = '<tr><td colspan="2" class="text-muted">尚未選擇產品</td></tr>';
    priceBlock.style.display = 'none';
    if (btnSubmit)  btnSubmit.disabled  = true;
    if (btnPreview) btnPreview.disabled = true;
    return;
  }

  let total = 0, totalMin = 0, totalCost = 0, totalRetail = 0;
  let rows = '';

  for (const p of allDbItems) {
    const qty       = extraSelected.get(p.id);
    const effPrice  = getEffectivePrice(p);
    const lineTotal = effPrice * qty;
    total       += lineTotal;
    totalMin    += (p.min_sell_price || 0) * qty;
    totalCost   += (p.cost_price     || 0) * qty;
    totalRetail += (p.retail_price   || 0) * qty;

    rows += `<tr>
      <td>${p.name_zh}${qty > 1 ? ` <span style="color:#1565C0;font-size:11px">×${qty}</span>` : ''}<br>
          <span class="text-muted" style="font-size:11px">${p.catalog_number}</span></td>
      <td>${lineTotal > 0 ? formatPrice(lineTotal, p.currency) : ''}</td>
    </tr>`;
  }

  for (const ci of customItems) {
    const lineTotal = ci.price * ci.quantity;
    total       += lineTotal;
    totalCost   += ci.cost  * ci.quantity;
    totalRetail += ci.price * ci.quantity;

    rows += `<tr>
      <td>${ci.name}${ci.quantity > 1 ? ` <span style="color:#1565C0;font-size:11px">×${ci.quantity}</span>` : ''}<br>
          <span class="text-muted" style="font-size:11px">${ci.catalogNumber || '自訂'}</span></td>
      <td>${lineTotal > 0 ? formatPrice(lineTotal) : ''}</td>
    </tr>`;
  }

  rows += `<tr class="total-row">
    <td>小計</td>
    <td>${total > 0 ? formatPrice(total) : '—'}</td>
  </tr>`;

  tbody.innerHTML = rows;

  const allFree = total === 0;
  let priceRowsHtml = '';
  if (user.role === 'customer') {
    priceRowsHtml = `
      <div class="price-block-row highlight">
        <span>建議零售價</span><span>${totalRetail > 0 ? formatPrice(totalRetail) : '洽詢'}</span>
      </div>`;
  } else if (user.role === 'sales') {
    priceRowsHtml = `
      <div class="price-block-row">
        <span>零售價</span><span>${formatPrice(totalRetail)}</span>
      </div>
      <div class="price-block-row highlight">
        <span>建議報價</span><span>${formatPrice(total)}</span>
      </div>
      <div class="price-block-row" style="color:#7B1FA2">
        <span>最低售價</span><span>${formatPrice(totalMin)}</span>
      </div>`;
  } else {
    priceRowsHtml = `
      <div class="price-block-row">
        <span>零售價</span><span>${formatPrice(totalRetail)}</span>
      </div>
      <div class="price-block-row highlight">
        <span>建議報價</span><span>${formatPrice(total)}</span>
      </div>
      <div class="price-block-row" style="color:#7B1FA2">
        <span>最低售價</span><span>${formatPrice(totalMin)}</span>
      </div>
      <div class="price-block-row" style="color:#B71C1C">
        <span>成本</span><span>${formatPrice(totalCost)}</span>
      </div>
      <div class="price-block-row" style="color:#388E3C; font-size:12px">
        <span>毛利（建議）</span><span>${formatPrice(total - totalCost)}</span>
      </div>`;
  }

  document.getElementById('priceRows').innerHTML = priceRowsHtml;
  priceBlock.style.display = 'block';
  if (btnSubmit)  btnSubmit.disabled  = false;
  if (btnPreview) btnPreview.disabled = false;
}

// ── Quote Modal ───────────────────────────────────────────────
let _quotePreviewOnly = false;
let _custSearchTimer  = null;
let _custSearchCache  = [];   // last search results

// ── Customer Search ───────────────────────────────────────────
function customerSearchInput(val) {
  clearTimeout(_custSearchTimer);
  const dd = document.getElementById('custDropdown');
  if (!val.trim()) { dd.style.display = 'none'; return; }
  _custSearchTimer = setTimeout(() => doCustomerSearch(val), 250);
}

async function doCustomerSearch(q) {
  const token = localStorage.getItem('token');
  try {
    const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) return;
    _custSearchCache = await res.json();
  } catch { return; }

  const dd = document.getElementById('custDropdown');
  if (!_custSearchCache.length) {
    dd.innerHTML = '<div style="padding:12px 16px;color:#999;font-size:13px">找不到符合的客戶，請直接填寫下方欄位</div>';
    dd.style.display = 'block';
    return;
  }
  dd.innerHTML = _custSearchCache.map(c => `
    <div onclick="selectCustomer(${c.id})" style="
      padding:10px 16px; cursor:pointer; border-bottom:1px solid #F0F0F0;
      display:flex; flex-direction:column; gap:2px;
    " onmouseenter="this.style.background='#F5F9FF'" onmouseleave="this.style.background=''">
      <span style="font-weight:600;font-size:13px">${escHtml(c.name)}${c.org ? ' · ' + escHtml(c.org) : ''}</span>
      <span style="font-size:11px;color:#888">${[c.phone, c.email].filter(Boolean).join(' · ') || '（無聯絡資訊）'}</span>
    </div>
  `).join('');
  dd.style.display = 'block';
}

function selectCustomer(id) {
  const c = _custSearchCache.find(x => x.id === id);
  if (!c) return;

  document.getElementById('cust_name').value  = c.name  || '';
  document.getElementById('cust_org').value   = c.org   || '';
  document.getElementById('cust_phone').value = c.phone || '';
  document.getElementById('cust_email').value = c.email || '';

  const badge = document.getElementById('custSelectedBadge');
  if (badge) { badge.textContent = c.org ? `${c.name} · ${c.org}` : c.name; badge.style.display = 'inline'; }
  const clearBtn = document.getElementById('custClearBtn');
  if (clearBtn) clearBtn.style.display = 'inline-flex';
  document.getElementById('custSearchInput').value = '';
  document.getElementById('custDropdown').style.display = 'none';
  renderInvoice();
}

function clearCustomerSelect() {
  ['cust_name','cust_org','cust_phone','cust_email'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const badge = document.getElementById('custSelectedBadge');
  if (badge) badge.style.display = 'none';
  const clearBtn = document.getElementById('custClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  document.getElementById('custSearchInput').value = '';
  renderInvoice();
}

// 點擊其他地方關閉搜尋結果
document.addEventListener('click', e => {
  if (!e.target.closest('#custSearchInput') && !e.target.closest('#custDropdown')) {
    const dd = document.getElementById('custDropdown');
    if (dd) dd.style.display = 'none';
  }
});

function openPreviewModal() {
  _quotePreviewOnly = true;
  // 編輯草稿模式保留已填入的客戶資料；新建模式則清空
  if (!_editingQuoteId) {
    ['cust_name','cust_org','cust_phone','cust_email'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }
  renderInvoice();
  document.getElementById('quoteModalSubmitBtn').style.display = 'none';
  document.getElementById('quoteModal').classList.add('open');
}

function openQuoteModal() {
  _quotePreviewOnly = false;
  // 編輯草稿模式保留已填入的客戶資料；新建模式則清空
  if (!_editingQuoteId) {
    ['cust_name','cust_org','cust_phone','cust_email'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  }
  renderInvoice();
  document.getElementById('quoteModalSubmitBtn').style.display = '';
  document.getElementById('quoteModal').classList.add('open');
}

// ── Category labels (shared with renderInvoice) ───────────────
const INVOICE_CATEGORY_LABELS = {
  base:         '基礎主機',
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

function renderInvoice() {
  const items = products.filter(p => extraSelected.has(p.id));
  const priceKey = user.role === 'customer' ? 'retail_price' : 'suggested_price';

  const custName  = document.getElementById('cust_name')?.value.trim()  || '（請填寫）';
  const custOrg   = document.getElementById('cust_org')?.value.trim()   || '';
  const custPhone = document.getElementById('cust_phone')?.value.trim() || '';
  const custEmail = document.getElementById('cust_email')?.value.trim() || '';
  const validDays = parseInt(document.getElementById('quote_valid_days')?.value) || 30;
  const customNotes = document.getElementById('quote_notes')?.value.trim() || '';

  const now     = new Date();
  const dateStr = now.toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' });
  const expDate = new Date(now.getTime() + validDays * 86400000)
    .toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' });

  const dbTotal = items.reduce((s, p) => {
    const qty = extraSelected.get(p.id);
    return s + getEffectivePrice(p) * (qty || 1);
  }, 0);
  const customTotal = customItems.reduce((s, ci) => s + ci.price * ci.quantity, 0);
  const total   = dbTotal + customTotal;
  const allFree = total === 0;

  // ── 依類別分組並建立表格列 ─────────────────────────────────
  const categoryOrder = ['base','orientation','clamping','holder','blade_base','blade_holder','blade','cooling','lighting','accessory'];
  const grouped = {};
  items.forEach(p => {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  });

  let rowNum = 0;
  let tableRows = '';
  for (const cat of categoryOrder) {
    const catItems = grouped[cat];
    if (!catItems) continue;
    tableRows += `
      <tr>
        <td colspan="5" style="
          padding: 7px 10px 5px;
          font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          color: #E3001B; background: #FFF5F5; border-top: 1px solid #FADAD9;
        ">${INVOICE_CATEGORY_LABELS[cat] || cat}</td>
      </tr>`;
    catItems.forEach(p => {
      rowNum++;
      const qty       = extraSelected.get(p.id) || 1;
      const unitPrice = getEffectivePrice(p);
      const subtotal  = unitPrice * qty;
      const bg = rowNum % 2 === 0 ? '#FAFAFA' : '#FFFFFF';
      const canEdit   = user.role !== 'customer';

      const priceCell = canEdit
        ? `<input
            id="invoice-price-${p.id}"
            class="invoice-price-input"
            type="number" min="0" step="1000"
            value="${unitPrice > 0 ? unitPrice : ''}"
            placeholder=""
            oninput="updateInvoicePrice(${p.id}, ${qty}, this)"
            onclick="event.stopPropagation()"
          >`
        : (unitPrice > 0 ? formatPrice(unitPrice) : '');

      tableRows += `
        <tr style="background:${bg}">
          <td style="padding:9px 10px; color:#222; font-size:12.5px; line-height:1.4">
            ${p.name_zh}
            ${p.is_included_in_base && !p.is_base_unit ? '<span style="font-size:10px;color:#28A745;margin-left:4px">（含於主機）</span>' : ''}
          </td>
          <td style="padding:9px 10px; color:#888; font-size:11px; font-family:monospace; white-space:nowrap">${p.catalog_number}</td>
          <td style="padding:9px 10px; text-align:right; color:#555; font-size:12px; white-space:nowrap">
            ${priceCell}
          </td>
          <td style="padding:9px 10px; text-align:center; color:#1A1A2E; font-size:12.5px; font-weight:600">${qty}</td>
          <td id="invoice-sub-${p.id}" style="padding:9px 10px; text-align:right; color:#1A1A2E; font-size:12.5px; font-weight:700; white-space:nowrap">
            ${subtotal > 0 ? formatPrice(subtotal) : ''}
          </td>
        </tr>`;
    });
  }

  // ── 自訂品項 ────────────────────────────────────────────────
  if (customItems.length > 0) {
    tableRows += `
      <tr>
        <td colspan="5" style="
          padding: 7px 10px 5px;
          font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          color: #E3001B; background: #FFF5F5; border-top: 1px solid #FADAD9;
        ">自訂品項</td>
      </tr>`;
    customItems.forEach(ci => {
      rowNum++;
      const subtotal = ci.price * ci.quantity;
      const bg = rowNum % 2 === 0 ? '#FAFAFA' : '#FFFFFF';
      tableRows += `
        <tr style="background:${bg}">
          <td style="padding:9px 10px; color:#222; font-size:12.5px; line-height:1.4">${escHtml(ci.name)}</td>
          <td style="padding:9px 10px; color:#888; font-size:11px; font-family:monospace; white-space:nowrap">${escHtml(ci.catalogNumber||'')}</td>
          <td style="padding:9px 10px; text-align:right; color:#555; font-size:12px; white-space:nowrap">
            ${ci.price > 0 ? formatPrice(ci.price) : ''}
          </td>
          <td style="padding:9px 10px; text-align:center; color:#1A1A2E; font-size:12.5px; font-weight:600">${ci.quantity}</td>
          <td style="padding:9px 10px; text-align:right; color:#1A1A2E; font-size:12.5px; font-weight:700; white-space:nowrap">
            ${subtotal > 0 ? formatPrice(subtotal) : ''}
          </td>
        </tr>`;
    });
  }

  const notesHtml = customNotes
    ? `<div style="margin-top:10px; padding:10px 12px; background:#FFFBF0; border-left:3px solid #F0AD00; border-radius:0 4px 4px 0; font-size:11px; color:#333; white-space:pre-wrap; line-height:1.8">${escHtml(customNotes)}</div>`
    : '';

  document.getElementById('quotePreviewBody').innerHTML = `
    <div id="printArea" style="
      font-family: -apple-system, 'Noto Sans TC', Helvetica, Arial, sans-serif;
      background: white; color: #1A1A2E;
      border-radius: 10px; border: 1px solid #E0E0E0;
      overflow: hidden;
    ">

      <!-- ▌頂部品牌色帶 -->
      <div style="background:#E3001B; height:5px"></div>

      <!-- ▌頁首區域 -->
      <div style="padding:28px 36px 22px; border-bottom:1px solid #EAEAEA">
        <div style="display:flex; justify-content:space-between; align-items:flex-start">

          <!-- 左：公司資訊 -->
          <div>
            <div style="display:flex; align-items:baseline; gap:10px">
              <span style="font-size:21px; font-weight:900; letter-spacing:0.5px; color:#1A1A2E">正茂生物科技</span>
              <span style="width:1px; height:16px; background:#CCC; display:inline-block; vertical-align:middle"></span>
              <span style="font-size:11px; color:#E3001B; font-weight:700; letter-spacing:1px">LEICA</span>
              <span style="font-size:10px; color:#888; letter-spacing:0.3px">Authorized Distributor</span>
            </div>
            <div style="font-size:11.5px; color:#666; margin-top:5px">
              GENMALL BIOTECH CO., LTD. &nbsp;·&nbsp; 台灣 Leica Biosystems 授權代理商
            </div>
          </div>

          <!-- 右：報價單標題 -->
          <div style="text-align:right">
            <div style="
              display:inline-block; background:#1A1A2E; color:white;
              font-size:12px; font-weight:700; letter-spacing:3px;
              padding:5px 14px; border-radius:4px; margin-bottom:8px;
            ">報 價 單</div>
            <div style="font-size:11px; color:#666; line-height:2">
              ${_lastQuoteNumber ? `報價編號：<strong style="color:#1A1A2E;font-family:monospace">${_lastQuoteNumber}</strong><br>` : ''}
              報價日期：<strong style="color:#1A1A2E">${dateStr}</strong><br>
              有效期限：<strong style="color:#E3001B">${expDate}</strong>（${validDays} 天）<br>
              負責業務：<strong style="color:#1A1A2E">${user.display_name || user.username}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- ▌客戶 & 產品資訊 -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0; border-bottom:1px solid #EAEAEA">
        <!-- 客戶資訊 -->
        <div style="padding:18px 36px; border-right:1px solid #EAEAEA">
          <div style="font-size:10px; font-weight:700; color:#E3001B; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px">報 價 對 象</div>
          <div style="font-size:15px; font-weight:700; color:#1A1A2E">${escHtml(custName)}</div>
          ${custOrg   ? `<div style="font-size:12.5px; color:#444; margin-top:3px">${escHtml(custOrg)}</div>` : ''}
          ${custPhone ? `<div style="font-size:11.5px; color:#666; margin-top:5px">📞&nbsp; ${escHtml(custPhone)}</div>` : ''}
          ${custEmail ? `<div style="font-size:11.5px; color:#666; margin-top:2px">✉&nbsp; ${escHtml(custEmail)}</div>` : ''}
        </div>
        <!-- 產品說明 -->
        <div style="padding:18px 36px; background:#FAFAFA">
          <div style="font-size:10px; font-weight:700; color:#E3001B; letter-spacing:1.5px; text-transform:uppercase; margin-bottom:8px">配 置 產 品</div>
          <div style="font-size:14px; font-weight:700; color:#1A1A2E">Leica Biosystems</div>
          <div style="font-size:12px; color:#666; margin-top:3px">產品選購配置方案</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap">
            <span style="background:#E8F0FE; color:#1565C0; font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px">
              共 ${items.length + customItems.length} 項配件
            </span>
            ${!allFree ? `<span style="background:#D4EDDA; color:#155724; font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px">
              合計 ${formatPrice(total)}
            </span>` : ''}
          </div>
        </div>
      </div>

      <!-- ▌品項明細表格 -->
      <div style="padding:0 36px">
        <table style="width:100%; border-collapse:collapse; margin:20px 0">
          <thead>
            <tr style="background:#1A1A2E">
              <th style="padding:9px 10px; text-align:left; font-size:10px; font-weight:600; color:rgba(255,255,255,0.8); letter-spacing:1px">品名</th>
              <th style="padding:9px 10px; text-align:left; font-size:10px; font-weight:600; color:rgba(255,255,255,0.8); letter-spacing:1px">料號</th>
              <th style="padding:9px 10px; text-align:right; font-size:10px; font-weight:600; color:rgba(255,255,255,0.8); letter-spacing:1px">單價（TWD）</th>
              <th style="padding:9px 10px; text-align:center; font-size:10px; font-weight:600; color:rgba(255,255,255,0.8); letter-spacing:1px">數量</th>
              <th style="padding:9px 10px; text-align:right; font-size:10px; font-weight:600; color:rgba(255,255,255,0.8); letter-spacing:1px">小計（TWD）</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>

      <!-- ▌合計金額區塊 -->
      <div style="margin:0 36px 24px; border:1px solid #EAEAEA; border-radius:8px; overflow:hidden">
        <div style="
          display:flex; justify-content:space-between; align-items:center;
          padding:16px 20px; background:${allFree ? '#F5F5F7' : '#1A1A2E'};
        ">
          <div>
            <div style="font-size:11px; font-weight:600; letter-spacing:1px; color:${allFree ? '#666' : 'rgba(255,255,255,0.7)'}">合計金額（TWD）</div>
            <div style="font-size:10px; color:${allFree ? '#999' : 'rgba(255,255,255,0.5)'}; margin-top:2px">含稅 · 新台幣</div>
          </div>
          <div id="invoice-total-amount" style="font-size:26px; font-weight:900; color:${allFree ? '#888' : 'white'}; letter-spacing:-0.5px">
            ${allFree ? '請洽業務' : formatPrice(total)}
          </div>
        </div>
        ${!allFree ? `<div style="padding:10px 20px; background:#F0F4FF; font-size:11px; color:#1565C0">
          ✦ 以上報價均為含稅價格，幣別：新台幣（TWD）
        </div>` : ''}
      </div>

      <!-- ▌簽名欄 + 注意事項 + 頁尾（整體 avoid page-break） -->
      <div class="invoice-footer-block">

        <!-- 簽名欄 -->
        <div style="margin:0 36px 24px; display:grid; grid-template-columns:1fr 1fr; gap:20px">
          <div style="border:1px dashed #CCC; border-radius:6px; padding:14px 16px; text-align:center">
            <div style="height:44px"></div>
            <div style="border-top:1px solid #AAA; padding-top:8px; margin-top:4px">
              <div style="font-size:10px; font-weight:700; color:#888; letter-spacing:0.5px">負責業務 簽名 / 用章</div>
              <div style="font-size:12px; color:#1A1A2E; margin-top:3px; font-weight:600">${user.display_name || user.username}</div>
            </div>
          </div>
          <div style="border:1px dashed #CCC; border-radius:6px; padding:14px 16px; text-align:center">
            <div style="height:44px"></div>
            <div style="border-top:1px solid #AAA; padding-top:8px; margin-top:4px">
              <div style="font-size:10px; font-weight:700; color:#888; letter-spacing:0.5px">客戶 確認簽名 / 用章</div>
              <div style="font-size:12px; color:#1A1A2E; margin-top:3px; font-weight:600">${custName !== '（請填寫）' ? custName : ''}</div>
            </div>
          </div>
        </div>

        <!-- 注意事項 & 自訂備註 -->
        <div style="padding:16px 36px 24px; background:#F8F8FA; border-top:1px solid #EAEAEA">
          <div style="font-size:10px; font-weight:700; color:#888; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px">注意事項</div>
          <div style="font-size:11px; color:#555; line-height:2">
            &bull;&ensp;本報價單有效期限為 <strong>${validDays}</strong> 天（至 ${expDate}），逾期請重新詢價。<br>
            &bull;&ensp;實際售價以正式採購合約為準，本公司保留調整價格之權利，恕不另行通知。<br>
            &bull;&ensp;原廠標準保固 1 年，可洽業務加購延長保固方案。<br>
            &bull;&ensp;如有任何疑問，請聯繫負責業務 <strong>${user.display_name || user.username}</strong>。
          </div>
          ${notesHtml}
        </div>

        <!-- 頁尾品牌條 -->
        <div style="background:#1A1A2E; padding:10px 36px; display:flex; justify-content:space-between; align-items:center">
          <div style="font-size:11px; font-weight:700; color:white; letter-spacing:2px">
            LEICA<span style="color:#E3001B">.</span>
            <span style="font-weight:300; letter-spacing:0.5px; margin-left:6px; font-size:10px">Biosystems</span>
          </div>
          <div style="font-size:10px; color:rgba(255,255,255,0.4)">正茂生物科技 · GENMALL BIOTECH</div>
        </div>

      </div>

    </div>
  `;
}

function generatePDF() {
  const invoiceEl = document.getElementById('printArea');
  if (!invoiceEl) return;

  const custName = document.getElementById('cust_name')?.value.trim() || '報價單';
  const now = new Date().toLocaleDateString('zh-TW').replace(/\//g, '');
  const pdfTitle = _lastQuoteNumber
    ? `報價單_${_lastQuoteNumber}_${custName}`
    : `報價單_正茂生物科技_${now}`;

  // 複製並將 invoice-price-input 換成靜態文字，避免列印出現空白輸入框
  const clone = invoiceEl.cloneNode(true);
  clone.querySelectorAll('.invoice-price-input').forEach(input => {
    const val = parseFloat(input.value);
    const span = document.createElement('span');
    span.style.cssText = 'font-size:12px;color:#555;font-weight:600';
    span.textContent = val > 0
      ? new Intl.NumberFormat('zh-TW', { style:'currency', currency:'TWD', maximumFractionDigits:0 }).format(val)
      : '';
    input.parentNode.replaceChild(span, input);
  });

  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${pdfTitle}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, 'PingFang TC', 'Noto Sans TC', Helvetica, Arial, sans-serif;
        background: white;
        color: #1A1A2E;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      @page {
        size: A4;
        margin: 12mm 14mm;
      }
      @media print {
        html, body { height: auto; }
        .no-print { display: none !important; }
        #printArea {
          border: none !important;
          border-radius: 0 !important;
          box-shadow: none !important;
        }
        .invoice-footer-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }
      }
      table { width: 100%; border-collapse: collapse; }
      #printArea { font-size: 12px; }
    </style>
  </head><body>${clone.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 700);
}

// ── Submit Quote ─────────────────────────────────────────────
async function submitQuote() {
  const customer_name = document.getElementById('cust_name').value.trim();
  if (!customer_name) { showToast('請先填寫客戶姓名', 'error'); return; }

  const productItems = [
    ...[...extraSelected.entries()].map(([id, qty]) => ({ product_id: id, quantity: qty })),
    ...[...autoDeps.entries()].map(([id, qty]) => ({ product_id: id, quantity: qty })),
  ];
  const customItemsPayload = customItems.map(ci => ({
    custom_name:           ci.name,
    custom_catalog_number: ci.catalogNumber,
    custom_cost:           ci.cost,
    unit_price:            ci.price,
    quantity:              ci.quantity,
  }));
  const allItems = [...productItems, ...customItemsPayload];

  const payload = {
    customer_name,
    customer_org:   document.getElementById('cust_org').value,
    customer_email: document.getElementById('cust_email').value,
    customer_phone: document.getElementById('cust_phone').value,
    items: allItems,
  };
  const case_notes = document.getElementById('case_notes')?.value?.trim() || '';

  let quoteId, quoteNumber;

  if (_editingQuoteId) {
    // 更新既有草稿
    const updateRes = await apiFetch(`/api/quotes/${_editingQuoteId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!updateRes || !updateRes.ok) {
      const err = await updateRes?.json();
      showToast(err?.error || '更新失敗', 'error');
      return;
    }
    quoteId     = _editingQuoteId;
    quoteNumber = new URLSearchParams(location.search).get('edit');
  } else {
    // 新建報價單
    const res = await apiFetch('/api/quotes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res || !res.ok) {
      const err = await res?.json();
      showToast(err?.error || '提交失敗', 'error');
      return;
    }
    const data = await res.json();
    quoteId     = data.id;
    quoteNumber = data.quote_number;
  }

  // 提交（草稿 → 待審批）
  const submitRes = await apiFetch(`/api/quotes/${quoteId}/submit`, {
    method: 'PUT',
    body: JSON.stringify({ case_notes }),
  });
  if (!submitRes || !submitRes.ok) {
    const err = await submitRes?.json();
    showToast(err?.error || '提交失敗', 'error');
    return;
  }

  const submitData = await submitRes.json();
  _lastQuoteNumber = quoteNumber;
  closeModal('quoteModal');
  showToast(`報價單 ${quoteNumber} 已提交！`, 'success');

  // 編輯草稿提交後跳回我的報價單
  if (_editingQuoteId) {
    setTimeout(() => { window.location.href = '/quotes.html'; }, 1200);
  }
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
