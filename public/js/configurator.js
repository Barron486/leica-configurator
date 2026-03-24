// ── HTML escape ──────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── State ─────────────────────────────────────────────────────
let user = null;
let products = [];
let selected     = new Map(); // id → quantity
let customPrices = new Map(); // id → manually entered price
let baseProduct  = null;
let _lastQuoteNumber = '';

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
  const items = products.filter(p => selected.has(p.id));
  const total   = items.reduce((s, p) => s + getEffectivePrice(p) * (selected.get(p.id) || 1), 0);
  const allFree = items.every(p => getEffectivePrice(p) === 0);
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

  // 從 URL ?bom=<id> 讀取指定 BOM，預選其品項
  const bomId = new URLSearchParams(location.search).get('bom');
  if (!bomId) {
    // 未帶 BOM 參數時，提示用戶先到產品目錄選擇
    document.getElementById('productList').innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:#888">
        <div style="font-size:32px;margin-bottom:12px">📦</div>
        <div style="font-weight:600;font-size:15px;color:#333;margin-bottom:8px">請先選擇產品</div>
        <div style="font-size:13px;margin-bottom:20px">請從產品目錄選擇要配置的儀器，再進行報價配置。</div>
        <a href="/products.html" class="btn btn-red" style="display:inline-block;text-decoration:none">前往產品目錄</a>
      </div>`;
    return;
  }
  if (bomId) {
    const bomRes = await apiFetch(`/api/admin/boms/${bomId}/config`);
    if (bomRes && bomRes.ok) {
      const { bom, items } = await bomRes.json();
      items.forEach(item => selected.set(item.product_id, item.quantity));
      // 顯示 BOM 名稱於頁首
      const titleEl = document.querySelector('.main-topbar-title');
      if (titleEl && bom.name) titleEl.textContent = bom.name;
    }
  }

  renderProducts();
  renderSummary();
})();

// ── Render product list ───────────────────────────────────────
// 只顯示 BOM 中已選的品項（不允許自由新增/移除）
function renderProducts() {
  const container = document.getElementById('productList');

  // 只取出已在 BOM 中的產品
  const bomItems = products.filter(p => selected.has(p.id));
  if (bomItems.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#888">BOM 無品項</div>';
    return;
  }

  const grouped = {};
  bomItems.forEach(p => {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  });

  const categoryOrder = ['base','orientation','clamping','holder','blade_base','blade_holder','blade','cooling','lighting','accessory'];

  let html = '';
  for (const cat of categoryOrder) {
    const items = grouped[cat];
    if (!items) continue;
    items.sort((a, b) => a.sort_order - b.sort_order);

    html += `<div class="category-section">
      <div class="category-title">${CATEGORY_LABELS[cat] || cat}</div>`;

    for (const p of items) {
      const isIncluded = p.is_included_in_base && !p.is_base_unit;
      const qty = selected.get(p.id) || 1;

      // BOM 品項固定選中，不可取消勾選
      html += `<div class="product-item selected">`;
      html += `<input type="checkbox" checked disabled>`;
      html += `<div class="product-info">`;
      html += `<div class="product-name">${p.name_zh}${isIncluded ? ' <span style="color:#28A745;font-size:11px">✓ 含於配置</span>' : ''}</div>`;
      html += `<div class="product-code">${p.catalog_number}</div>`;
      if (p.description) html += `<div class="product-desc">${p.description}</div>`;
      if (p.notes) html += `<div class="product-note">⚠ ${p.notes}</div>`;
      html += `</div>`;

      // Price + qty stepper
      html += `<div class="product-price">`;
      html += renderPriceColumn(p);
      html += `<div class="qty-stepper" onclick="event.stopPropagation()">
        <button class="qty-btn" onclick="changeQty(${p.id}, -1)">−</button>
        <span class="qty-val">${qty}</span>
        <button class="qty-btn" onclick="changeQty(${p.id}, 1)">+</button>
      </div>`;
      html += `</div></div>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
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

// ── Toggle selection ─────────────────────────────────────────
function toggleProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p || p.is_base_unit) return;

  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.set(id, 1);
  }
  renderProducts();
  renderSummary();
}

// ── Change quantity ───────────────────────────────────────────
function changeQty(id, delta) {
  if (!selected.has(id)) return;
  const newQty = (selected.get(id) || 1) + delta;
  if (newQty < 1) {
    // BOM 品項數量最低為 1，不允許移除
    return;
  } else if (newQty > 99) {
    return;
  } else {
    selected.set(id, newQty);
  }
  renderProducts();
  renderSummary();
}

// ── Render summary ────────────────────────────────────────────
function renderSummary() {
  const items = products.filter(p => selected.has(p.id));
  const tbody = document.getElementById('summaryItems');
  const priceBlock = document.getElementById('priceBlock');
  const btnSubmit  = document.getElementById('btnSubmit');
  const btnPreview = document.getElementById('btnPreview');

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="text-muted">尚未選擇產品</td></tr>';
    priceBlock.style.display = 'none';
    if (btnSubmit)  btnSubmit.disabled  = true;
    if (btnPreview) btnPreview.disabled = true;
    return;
  }

  let total = 0;
  let totalMin = 0, totalCost = 0, totalRetail = 0;
  let rows = '';

  for (const p of items) {
    const qty      = selected.get(p.id) || 1;
    const effPrice = getEffectivePrice(p);
    const lineTotal = effPrice * qty;
    total       += lineTotal;
    totalMin    += (p.min_sell_price || 0) * qty;
    totalCost   += (p.cost_price     || 0) * qty;
    totalRetail += (p.retail_price   || 0) * qty;

    const priceDisplay = lineTotal > 0
      ? formatPrice(lineTotal, p.currency)
      : customPrices.has(p.id) ? '' : '';  // 無資料時留空

    rows += `<tr>
      <td>${p.name_zh}${qty > 1 ? ` <span style="color:#1565C0;font-size:11px">×${qty}</span>` : ''}<br>
          <span class="text-muted" style="font-size:11px">${p.catalog_number}</span></td>
      <td>${priceDisplay}</td>
    </tr>`;
  }

  rows += `<tr class="total-row">
    <td>小計</td>
    <td>${total > 0 ? formatPrice(total) : '—'}</td>
  </tr>`;

  tbody.innerHTML = rows;

  // Price summary block
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
    // admin
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

function openPreviewModal() {
  _quotePreviewOnly = true;
  ['cust_name','cust_org','cust_phone','cust_email'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderInvoice();
  // 預覽模式：隱藏提交按鈕
  document.getElementById('quoteModalSubmitBtn').style.display = 'none';
  document.getElementById('quoteModal').classList.add('open');
}

function openQuoteModal() {
  _quotePreviewOnly = false;
  ['cust_name','cust_org','cust_phone','cust_email'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  renderInvoice();
  document.getElementById('quoteModalSubmitBtn').style.display = '';
  document.getElementById('quoteModal').classList.add('open');
}

// ── Category labels (shared with renderProducts) ──────────────
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
  const items = products.filter(p => selected.has(p.id));
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

  const total   = items.reduce((s, p) => s + getEffectivePrice(p) * (selected.get(p.id) || 1), 0);
  const allFree = items.every(p => getEffectivePrice(p) === 0);

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
    // 分類標題列
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
      const qty       = selected.get(p.id) || 1;
      const unitPrice = getEffectivePrice(p);
      const subtotal  = unitPrice * qty;
      const bg = rowNum % 2 === 0 ? '#FAFAFA' : '#FFFFFF';
      const canEdit   = user.role !== 'customer';

      // 單價欄：可編輯（非客戶）或純文字（客戶）
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
          <div style="font-size:14px; font-weight:700; color:#1A1A2E">Leica HistoCore MULTICUT</div>
          <div style="font-size:12px; color:#666; margin-top:3px">輪轉式切片機配置方案</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap">
            <span style="background:#E8F0FE; color:#1565C0; font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px">
              共 ${items.length} 項配件
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

  const items = [...selected.entries()].map(([id, qty]) => ({ product_id: id, quantity: qty }));

  const res = await apiFetch('/api/quotes', {
    method: 'POST',
    body: JSON.stringify({
      customer_name,
      customer_org:   document.getElementById('cust_org').value,
      customer_email: document.getElementById('cust_email').value,
      customer_phone: document.getElementById('cust_phone').value,
      items,
    }),
  });

  if (!res || !res.ok) {
    const err = await res?.json();
    showToast(err?.error || '提交失敗', 'error');
    return;
  }

  const data = await res.json();
  const case_notes = document.getElementById('case_notes')?.value?.trim() || '';
  await apiFetch(`/api/quotes/${data.id}/submit`, {
    method: 'PUT',
    body: JSON.stringify({ case_notes }),
  });

  _lastQuoteNumber = data.quote_number;
  closeModal('quoteModal');
  showToast(`報價單 ${data.quote_number} 已提交！`, 'success');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
