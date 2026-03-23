// ── State ─────────────────────────────────────────────────────
let user = null;
let products = [];
let selected = new Set(); // product ids
let baseProduct = null;

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
  if (user.role === 'admin') document.getElementById('adminLink').style.display = 'block';

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

  // Pre-select base unit + all included items
  products.filter(p => p.is_base_unit || p.is_included_in_base).forEach(p => selected.add(p.id));
  baseProduct = products.find(p => p.is_base_unit);

  renderProducts();
  renderSummary();
})();

// ── Render product list ───────────────────────────────────────
function renderProducts() {
  const container = document.getElementById('productList');
  const grouped = {};
  products.forEach(p => {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  });

  const categoryOrder = ['base','orientation','clamping','holder','blade_base','blade_holder','blade','cooling','lighting','accessory'];

  let html = '';
  for (const cat of categoryOrder) {
    const items = grouped[cat];
    if (!items) continue;
    html += `<div class="category-section">
      <div class="category-title">${CATEGORY_LABELS[cat] || cat}</div>`;

    // 已選項目排最前面
    items.sort((a, b) => {
      const selA = selected.has(a.id) ? 0 : 1;
      const selB = selected.has(b.id) ? 0 : 1;
      return selA - selB || a.sort_order - b.sort_order;
    });

    for (const p of items) {
      const isBase = p.is_base_unit;
      const isIncluded = p.is_included_in_base && !p.is_base_unit;
      const isSel = selected.has(p.id);

      html += `<div class="product-item ${isSel ? 'selected' : ''} ${isBase ? 'base-item' : ''}" onclick="toggleProduct(${p.id})">`;
      html += `<input type="checkbox" ${isSel ? 'checked' : ''} ${isBase ? 'disabled' : ''} onclick="event.stopPropagation(); toggleProduct(${p.id})">`;
      html += `<div class="product-info">`;
      html += `<div class="product-name">${p.name_zh}${isIncluded ? ' <span style="color:#28A745;font-size:11px">✓ 含於配置</span>' : ''}</div>`;
      html += `<div class="product-code">${p.catalog_number}</div>`;
      if (p.description) html += `<div class="product-desc">${p.description}</div>`;
      if (p.notes) html += `<div class="product-note">⚠ ${p.notes}</div>`;
      html += `</div>`;

      // Price column
      html += `<div class="product-price">`;
      html += renderPriceColumn(p);
      html += `</div></div>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
}

function renderPriceColumn(p) {
  const currency = p.currency || 'TWD';

  if (user.role === 'admin') {
    return `
      <div class="price-label">零售</div><div class="price-retail">${formatPrice(p.retail_price, currency)}</div>
      <div class="price-label">建議</div><div class="price-suggest">${formatPrice(p.suggested_price, currency)}</div>
      <div class="price-min">最低 ${formatPrice(p.min_sell_price, currency)}</div>
      <div class="price-cost">成本 ${formatPrice(p.cost_price, currency)}</div>
    `;
  } else if (user.role === 'sales') {
    return `
      <div class="price-label">建議報價</div>
      <div class="price-suggest">${formatPrice(p.suggested_price, currency)}</div>
      <div class="price-min">最低 ${formatPrice(p.min_sell_price, currency)}</div>
      <div class="price-label">零售</div><div class="price-retail">${formatPrice(p.retail_price, currency)}</div>
    `;
  } else {
    const price = p.retail_price;
    return price && price > 0
      ? `<div class="price-retail" style="font-size:14px">${formatPrice(price, currency)}</div>`
      : `<div class="price-zero">洽詢報價</div>`;
  }
}

// ── Toggle selection ─────────────────────────────────────────
function toggleProduct(id) {
  const p = products.find(x => x.id === id);
  if (!p || p.is_base_unit) return; // base is always selected

  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
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

  // Determine price key to display
  const priceKey = user.role === 'customer' ? 'retail_price' : 'suggested_price';

  let total = 0;
  let totalMin = 0, totalCost = 0, totalRetail = 0;
  let rows = '';

  for (const p of items) {
    const price = p[priceKey] || 0;
    total += price;
    totalMin += p.min_sell_price || 0;
    totalCost += p.cost_price || 0;
    totalRetail += p.retail_price || 0;

    rows += `<tr>
      <td>${p.name_zh}<br><span class="text-muted" style="font-size:11px">${p.catalog_number}</span></td>
      <td>${price > 0 ? formatPrice(price, p.currency) : '—'}</td>
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

  const total   = items.reduce((s, p) => s + (p[priceKey] || 0), 0);
  const allFree = items.every(p => !p[priceKey] || p[priceKey] === 0);

  const rows = items.map(p => `
    <tr style="border-bottom:1px solid #E8E8ED">
      <td style="padding:12px 0; color:#1D1D1F">${p.name_zh}</td>
      <td style="padding:12px 0; color:#86868B; font-size:12px">${p.catalog_number}</td>
      <td style="padding:12px 0; text-align:center; color:#1D1D1F">1</td>
      <td style="padding:12px 0; text-align:right; color:#1D1D1F; font-weight:500">
        ${p[priceKey] > 0 ? formatPrice(p[priceKey]) : '<span style="color:#86868B">洽詢</span>'}
      </td>
    </tr>`).join('');

  const notesHtml = customNotes
    ? `<div style="margin-top:12px; font-size:11px; color:#1D1D1F; white-space:pre-wrap; line-height:1.7">${customNotes}</div>`
    : '';

  document.getElementById('quotePreviewBody').innerHTML = `
    <div id="printArea" style="
      font-family: -apple-system, 'Noto Sans TC', Helvetica, sans-serif;
      background: white; color: #1D1D1F; padding: 40px;
      border-radius: 12px; border: 1px solid #E8E8ED;
    ">

      <!-- 表頭 -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:36px; padding-bottom:24px; border-bottom:2px solid #1D1D1F">
        <div>
          <div style="font-size:22px; font-weight:700; letter-spacing:-0.3px; color:#1D1D1F">正茂生物科技</div>
          <div style="font-size:12px; color:#86868B; margin-top:2px; letter-spacing:0.5px">GENMALL BIOTECH CO., LTD.</div>
          <div style="font-size:11px; color:#86868B; margin-top:8px; line-height:1.8">
            台灣 · Leica Biosystems 授權代理商
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px">報  價  單</div>
          <div style="font-size:11px; color:#86868B; line-height:2">
            報價日期：${dateStr}<br>
            有效期限：${expDate}（${validDays} 天）<br>
            負責業務：${user.display_name || user.username}
          </div>
        </div>
      </div>

      <!-- 客戶資訊 -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:36px">
        <div>
          <div style="font-size:10px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px">報價對象</div>
          <div style="font-size:14px; font-weight:600; color:#1D1D1F">${custName}</div>
          ${custOrg   ? `<div style="font-size:13px; color:#1D1D1F; margin-top:2px">${custOrg}</div>` : ''}
          ${custPhone ? `<div style="font-size:12px; color:#86868B; margin-top:4px">📞 ${custPhone}</div>` : ''}
          ${custEmail ? `<div style="font-size:12px; color:#86868B; margin-top:2px">✉ ${custEmail}</div>` : ''}
        </div>
        <div>
          <div style="font-size:10px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase; margin-bottom:8px">產品系列</div>
          <div style="font-size:13px; color:#1D1D1F">Leica HistoCore MULTICUT</div>
          <div style="font-size:12px; color:#86868B; margin-top:2px">輪轉式切片機配置方案</div>
        </div>
      </div>

      <!-- 品項表格 -->
      <table style="width:100%; border-collapse:collapse; margin-bottom:24px">
        <thead>
          <tr style="border-bottom:1px solid #1D1D1F">
            <th style="padding:8px 0; text-align:left; font-size:10px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase">品名</th>
            <th style="padding:8px 0; text-align:left; font-size:10px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase">料號</th>
            <th style="padding:8px 0; text-align:center; font-size:10px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase">數量</th>
            <th style="padding:8px 0; text-align:right; font-size:10px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase">單價</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <!-- 合計 -->
      <div style="border-top:2px solid #1D1D1F; padding-top:16px; margin-bottom:32px">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <div>
            <div style="font-size:10px; font-weight:600; color:#86868B; letter-spacing:1px; text-transform:uppercase">合計金額</div>
            <div style="font-size:11px; color:#86868B; margin-top:2px">新台幣（含稅）</div>
          </div>
          <div style="font-size:22px; font-weight:700; color:#1D1D1F">
            ${allFree ? '<span style="font-size:15px;color:#86868B">請洽業務</span>' : formatPrice(total)}
          </div>
        </div>
      </div>

      <!-- 簽名欄 -->
      <div style="display:flex; justify-content:space-between; margin-bottom:28px">
        <div style="text-align:center">
          <div style="border-bottom:1px solid #86868B; width:180px; height:40px; margin-bottom:6px"></div>
          <div style="font-size:11px; color:#86868B">負責業務簽名</div>
          <div style="font-size:12px; color:#1D1D1F; margin-top:2px">${user.display_name || user.username}</div>
        </div>
        <div style="text-align:center">
          <div style="border-bottom:1px solid #86868B; width:180px; height:40px; margin-bottom:6px"></div>
          <div style="font-size:11px; color:#86868B">客戶確認簽名</div>
          <div style="font-size:12px; color:#1D1D1F; margin-top:2px">${custName !== '（請填寫）' ? custName : ''}</div>
        </div>
      </div>

      <!-- 備註 -->
      <div style="border-top:1px solid #E8E8ED; padding-top:16px">
        <div style="font-size:11px; color:#86868B; line-height:1.9">
          <span style="font-weight:600">注意事項</span><br>
          · 以上報價有效期 ${validDays} 天，逾期請重新詢價。<br>
          · 實際售價以正式合約為準，價格如有調整恕不另行通知。<br>
          · 原廠保固 1 年，可選購延長保固服務。
        </div>
        ${notesHtml}
      </div>

    </div>
  `;
}

function generatePDF() {
  const invoiceEl = document.getElementById('printArea');
  if (!invoiceEl) return;

  const custName = document.getElementById('cust_name')?.value.trim() || '報價單';
  const now = new Date().toLocaleDateString('zh-TW').replace(/\//g, '');

  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>報價單_正茂生物科技_${now}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, 'Noto Sans TC', Helvetica, sans-serif;
        background: white; padding: 32px 40px; color: #1D1D1F;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      @page { size: A4; margin: 15mm 20mm; }
      @media print {
        body { padding: 0; }
        .no-print { display: none !important; }
      }
      table { width: 100%; border-collapse: collapse; }
    </style>
  </head><body>${invoiceEl.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 600);
}

// ── Submit Quote ─────────────────────────────────────────────
async function submitQuote() {
  const customer_name = document.getElementById('cust_name').value.trim();
  if (!customer_name) { showToast('請先填寫客戶姓名', 'error'); return; }

  const items = [...selected].map(id => ({ product_id: id, quantity: 1 }));

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
  await apiFetch(`/api/quotes/${data.id}/submit`, { method: 'PUT' });

  closeModal('quoteModal');
  showToast(`報價單 ${data.quote_number} 已提交！`, 'success');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
