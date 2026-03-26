'use strict';

const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const { getDb } = require('../database/schema');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const ADMIN_ROLES = ['admin', 'super_admin', 'pm'];

function permPmImport(req, res, next) {
  if (ADMIN_ROLES.includes(req.user?.role)) return next();
  const db = getDb();
  const rp = db.prepare('SELECT manage_products, manage_pricing FROM role_permissions WHERE role=?').get(req.user?.role);
  db.close();
  if (!rp?.manage_products && !rp?.manage_pricing) {
    return res.status(403).json({ error: '無產品/定價管理權限' });
  }
  next();
}

const VALID_CATEGORIES = [
  'base', 'orientation', 'clamping', 'holder',
  'blade_base', 'blade_holder', 'blade', 'cooling', 'lighting', 'accessory',
];

const CATEGORY_LABELS = {
  base: '基礎配置', orientation: '檢體夾具固定裝置', clamping: '快速夾緊系統',
  holder: '檢體夾具', blade_base: '刀架底座', blade_holder: '刀架/刀片架',
  blade: '刀片（耗材）', cooling: '冷卻系統', lighting: '照明與觀察裝置', accessory: '其他配件',
};

// ── GET /api/admin/pm-import/template ─────────────────────────
// 下載 Excel 範本（雙工作表）
router.get('/template', permPmImport, (req, res) => {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: 新增產品 ──────────────────────────────────────
  const productHeaders = [
    '料號*', '中文名稱*', '英文名稱', '類別*(見下方對照)',
    '說明', '注意事項', '排序號',
    '是否主機(0或1)', '含於基礎配置(0或1)',
    '成本價', '最低售價', '建議報價', '零售價',
  ];
  const productHint = [
    '← 必填，需唯一', '← 必填', '← 選填', '← 必填，填英文 key（見下方）',
    '', '', '← 整數，預設 99',
    '← 0=否 1=是', '← 0=否 1=是',
    '← 整數，單位 TWD', '', '', '',
  ];
  const catRefTitle = ['', '', '', '【類別代碼對照表】（複製 key 填入「類別」欄）'];
  const catRows = Object.entries(CATEGORY_LABELS).map(([k, v]) => ['', '', '', `${k}  →  ${v}`]);

  const ws1Data = [
    productHeaders,
    productHint,
    [],
    catRefTitle,
    ...catRows,
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
  ws1['!cols'] = [
    { wch: 16 }, { wch: 26 }, { wch: 26 }, { wch: 22 },
    { wch: 30 }, { wch: 20 }, { wch: 8 },
    { wch: 14 }, { wch: 18 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, '新增產品');

  // ── Sheet 2: 價格維護 ──────────────────────────────────────
  const priceHeaders = ['料號*', '成本價', '最低售價', '建議報價', '零售價', '備注'];
  const priceHint    = ['← 必填，需與資料庫既有料號相符', '← 留空則不更新', '', '', '', '← 選填'];
  const ws2Data = [priceHeaders, priceHint];
  const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
  ws2['!cols'] = [
    { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '價格維護');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="pm-product-price-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── POST /api/admin/pm-import/preview ─────────────────────────
// 解析雙工作表，回傳預覽資料（不寫入 DB）
router.post('/preview', permPmImport, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳 Excel 檔案' });

  let wb;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  } catch (e) {
    return res.status(400).json({ error: '無法解析 Excel 檔案：' + e.message });
  }

  // 尋找工作表（名稱不分大小寫）
  function findSheet(keyword) {
    const re = new RegExp(keyword, 'i');
    return wb.SheetNames.find(n => re.test(n));
  }
  const sheet1Name = findSheet('新增|product|產品');
  const sheet2Name = findSheet('價格|price|pricing');

  const db = getDb();
  const existingRows = db.prepare('SELECT catalog_number, id, name_zh FROM products').all();
  const existingMap  = new Map(existingRows.map(r => [r.catalog_number, r]));
  db.close();

  // ── 解析 Sheet 1 ──────────────────────────────────────────
  let productRows = [];
  if (sheet1Name) {
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheet1Name], { defval: '' });
    // 跳過「提示列」（第一欄包含「←」的列）
    const data = raw.filter(r => !String(Object.values(r)[0] ?? '').includes('←'));

    productRows = data.map(r => {
      // 欄位名稱彈性對應（中英文皆可）
      const cn   = r['料號*']          ?? r['料號']         ?? r['catalog_number'] ?? '';
      const zh   = r['中文名稱*']      ?? r['中文名稱']     ?? r['name_zh']        ?? '';
      const en   = r['英文名稱']        ?? r['name_en']     ?? '';
      const cat  = r['類別*(見下方對照)'] ?? r['類別*(見下方對照)'] ?? r['類別*'] ?? r['類別'] ?? r['category'] ?? '';
      const desc = r['說明']            ?? r['description'] ?? '';
      const notes= r['注意事項']        ?? r['notes']       ?? '';
      const sort = parseInt(r['排序號'] ?? r['sort_order']  ?? 99) || 99;
      const isBase     = parseInt(r['是否主機(0或1)']         ?? r['is_base_unit']         ?? 0) ? 1 : 0;
      const inBase     = parseInt(r['含於基礎配置(0或1)']     ?? r['is_included_in_base']  ?? 0) ? 1 : 0;
      const cost       = parseFloat(r['成本價']     ?? r['cost_price']     ?? '') || null;
      const minSell    = parseFloat(r['最低售價']   ?? r['min_sell_price'] ?? '') || null;
      const suggested  = parseFloat(r['建議報價']   ?? r['suggested_price']?? '') || null;
      const retail     = parseFloat(r['零售價']     ?? r['retail_price']   ?? '') || null;

      const errors = [];
      if (!cn)  errors.push('缺少料號');
      if (!zh)  errors.push('缺少中文名稱');
      if (!VALID_CATEGORIES.includes(String(cat).trim())) errors.push(`類別無效：「${cat}」`);

      const catKey = String(cat).trim();
      return {
        catalog_number: String(cn).trim(),
        name_zh: String(zh).trim(),
        name_en: String(en).trim(),
        category: catKey,
        description: String(desc).trim(),
        notes: String(notes).trim(),
        sort_order: sort,
        is_base_unit: isBase,
        is_included_in_base: inBase,
        cost_price: cost,
        min_sell_price: minSell,
        suggested_price: suggested,
        retail_price: retail,
        _status: errors.length ? 'error' : existingMap.has(String(cn).trim()) ? 'update' : 'new',
        _errors: errors,
        _category_label: CATEGORY_LABELS[catKey] || catKey,
      };
    }).filter(r => r.catalog_number || r.name_zh); // 跳過完全空白列
  }

  // ── 解析 Sheet 2 ──────────────────────────────────────────
  let priceRows = [];
  if (sheet2Name) {
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheet2Name], { defval: '' });
    const data = raw.filter(r => !String(Object.values(r)[0] ?? '').includes('←'));

    priceRows = data.map(r => {
      const cn       = r['料號*']    ?? r['料號']         ?? r['catalog_number'] ?? '';
      const cost     = r['成本價']   ?? r['cost_price']   ?? '';
      const minSell  = r['最低售價'] ?? r['min_sell_price']?? '';
      const suggested= r['建議報價'] ?? r['suggested_price']?? '';
      const retail   = r['零售價']   ?? r['retail_price'] ?? '';
      const note     = r['備注']     ?? r['notes']        ?? '';

      const cnStr = String(cn).trim();
      const errors = [];
      if (!cnStr) errors.push('缺少料號');
      else if (!existingMap.has(cnStr)) errors.push('料號不存在於資料庫');

      return {
        catalog_number: cnStr,
        cost_price:     cost     === '' ? null : parseFloat(cost)     || 0,
        min_sell_price: minSell  === '' ? null : parseFloat(minSell)  || 0,
        suggested_price:suggested === '' ? null : parseFloat(suggested)|| 0,
        retail_price:   retail   === '' ? null : parseFloat(retail)   || 0,
        notes: String(note).trim(),
        _status: errors.length ? 'error' : 'update',
        _errors: errors,
        _existing_name: existingMap.get(cnStr)?.name_zh ?? '',
      };
    }).filter(r => r.catalog_number);
  }

  res.json({
    products: {
      total:        productRows.length,
      new_count:    productRows.filter(r => r._status === 'new').length,
      update_count: productRows.filter(r => r._status === 'update').length,
      error_count:  productRows.filter(r => r._status === 'error').length,
      rows: productRows,
    },
    prices: {
      total:       priceRows.length,
      update_count:priceRows.filter(r => r._status === 'update').length,
      error_count: priceRows.filter(r => r._status === 'error').length,
      rows: priceRows,
    },
  });
});

// ── POST /api/admin/pm-import/confirm ─────────────────────────
// 確認並寫入資料庫
router.post('/confirm', permPmImport, (req, res) => {
  const { products = [], prices = [] } = req.body;

  const db = getDb();

  const upsertProduct = db.prepare(`
    INSERT INTO products
      (catalog_number, name_zh, name_en, category, is_base_unit, is_included_in_base,
       description, notes, sort_order)
    VALUES
      (@catalog_number, @name_zh, @name_en, @category, @is_base_unit, @is_included_in_base,
       @description, @notes, @sort_order)
    ON CONFLICT(catalog_number) DO UPDATE SET
      name_zh=excluded.name_zh, name_en=excluded.name_en,
      category=excluded.category, is_base_unit=excluded.is_base_unit,
      is_included_in_base=excluded.is_included_in_base,
      description=excluded.description, notes=excluded.notes,
      sort_order=excluded.sort_order
  `);

  const insertPricing = db.prepare(`
    INSERT INTO pricing (product_id, cost_price, min_sell_price, suggested_price, retail_price, currency)
    VALUES (?, ?, ?, ?, ?, 'TWD')
    ON CONFLICT DO NOTHING
  `);

  const updatePricingField = db.prepare(`
    UPDATE pricing SET
      cost_price      = CASE WHEN @cost_price      IS NOT NULL THEN @cost_price      ELSE cost_price END,
      min_sell_price  = CASE WHEN @min_sell_price  IS NOT NULL THEN @min_sell_price  ELSE min_sell_price END,
      suggested_price = CASE WHEN @suggested_price IS NOT NULL THEN @suggested_price ELSE suggested_price END,
      retail_price    = CASE WHEN @retail_price    IS NOT NULL THEN @retail_price    ELSE retail_price END,
      updated_at      = CURRENT_TIMESTAMP
    WHERE product_id = @product_id
  `);

  const getId = db.prepare('SELECT id FROM products WHERE catalog_number=?');

  let prodInserted = 0, prodUpdated = 0, priceUpdated = 0;

  const validProducts = (products || []).filter(p =>
    p.catalog_number && p.name_zh && VALID_CATEGORIES.includes(p.category) && p._status !== 'error'
  );
  const validPrices = (prices || []).filter(p =>
    p.catalog_number && p._status !== 'error'
  );

  const doImport = db.transaction(() => {
    // 1. 寫入 / 更新產品
    for (const p of validProducts) {
      const result = upsertProduct.run({
        catalog_number:      p.catalog_number,
        name_zh:             p.name_zh,
        name_en:             p.name_en   || '',
        category:            p.category,
        is_base_unit:        p.is_base_unit   ? 1 : 0,
        is_included_in_base: p.is_included_in_base ? 1 : 0,
        description:         p.description   || '',
        notes:               p.notes         || '',
        sort_order:          p.sort_order     ?? 99,
      });

      const isNew = result.lastInsertRowid > 0 && result.changes === 1;
      const pid   = isNew ? result.lastInsertRowid : getId.get(p.catalog_number).id;

      if (isNew) {
        prodInserted++;
        insertPricing.run(pid,
          p.cost_price ?? 0, p.min_sell_price ?? 0,
          p.suggested_price ?? 0, p.retail_price ?? 0
        );
      } else {
        prodUpdated++;
        updatePricingField.run({
          product_id:      pid,
          cost_price:      p.cost_price     ?? null,
          min_sell_price:  p.min_sell_price ?? null,
          suggested_price: p.suggested_price?? null,
          retail_price:    p.retail_price   ?? null,
        });
      }
    }

    // 2. 僅更新定價（Sheet 2）
    for (const p of validPrices) {
      const row = getId.get(p.catalog_number);
      if (!row) continue;
      updatePricingField.run({
        product_id:      row.id,
        cost_price:      p.cost_price     ?? null,
        min_sell_price:  p.min_sell_price ?? null,
        suggested_price: p.suggested_price?? null,
        retail_price:    p.retail_price   ?? null,
      });
      priceUpdated++;
    }
  });

  doImport();
  db.close();

  res.json({
    message: '匯入完成',
    products_inserted: prodInserted,
    products_updated:  prodUpdated,
    prices_updated:    priceUpdated,
  });
});

module.exports = router;
