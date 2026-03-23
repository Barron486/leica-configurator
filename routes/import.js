'use strict';

const express  = require('express');
const multer   = require('multer');
const XLSX     = require('xlsx');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../database/schema');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_CATEGORIES = [
  'base','orientation','clamping','holder',
  'blade_base','blade_holder','blade','cooling','lighting','accessory',
];

const CATEGORY_LABELS = {
  base:'基礎配置', orientation:'檢體夾具固定裝置', clamping:'快速夾緊系統',
  holder:'檢體夾具', blade_base:'刀架底座', blade_holder:'刀架/刀片架',
  blade:'刀片（耗材）', cooling:'冷卻系統', lighting:'照明與觀察裝置', accessory:'其他配件',
};

const SYSTEM_PROMPT = `你是 Leica 醫療設備產品資料分析師。
分析 Excel 產品資料，對應到以下資料庫欄位格式。

欄位定義：
- catalog_number (料號, 必填, 唯一)
- name_zh (中文名稱, 必填)
- name_en (英文名稱, 選填)
- category (類別, 必填，只能是以下英文 key 之一):
  base=基礎配置, orientation=檢體夾具固定裝置, clamping=快速夾緊系統,
  holder=檢體夾具, blade_base=刀架底座, blade_holder=刀架/刀片架,
  blade=刀片（耗材）, cooling=冷卻系統, lighting=照明與觀察裝置, accessory=其他配件
- description (說明, 選填)
- notes (注意事項, 選填)
- sort_order (排序號, 整數, 選填)
- is_base_unit (是否為主機, 0或1)
- is_included_in_base (是否含於基礎配置, 0或1)
- cost_price (成本價, 數字)
- min_sell_price (最低售價, 數字)
- suggested_price (建議報價, 數字)
- retail_price (建議零售價, 數字)

回傳規則：
1. 只輸出純 JSON 陣列，不加任何說明或 markdown
2. 每筆必須包含 catalog_number、name_zh、category
3. category 只用英文 key
4. 無法判斷的欄位直接省略
5. 「主機」「基礎配置」→ is_base_unit:1
6. 「含於基礎」「標準配件」→ is_included_in_base:1`;

// ── POST /api/admin/import/preview ────────────────────────────
// 上傳 Excel → Claude 分析 → 回傳預覽資料（不寫入 DB）
router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳 Excel 檔案' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: '伺服器未設定 ANTHROPIC_API_KEY' });

  // 解析 Excel
  let rows;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    let sheetName = wb.SheetNames[0];
    for (const name of wb.SheetNames) {
      if (/產品|product|商品|item/i.test(name)) { sheetName = name; break; }
    }
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  } catch (e) {
    return res.status(400).json({ error: '無法解析 Excel 檔案：' + e.message });
  }

  if (!rows.length) return res.status(400).json({ error: 'Excel 無資料' });

  // 呼叫 Claude
  const client = new Anthropic({ apiKey });
  const userMsg = `Excel 共 ${rows.length} 筆，欄位：${Object.keys(rows[0]).join('、')}

${JSON.stringify(rows, null, 2)}

請直接輸出 JSON 陣列。`;

  let products;
  try {
    const msg = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = msg.content[0].text.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    const match = text.match(/\[[\s\S]+\]/);
    products = JSON.parse(match ? match[0] : text);
  } catch (e) {
    return res.status(500).json({ error: 'Claude 分析失敗：' + e.message });
  }

  // 驗證並標記每筆狀態
  const db = getDb();
  const existing = new Set(
    db.prepare('SELECT catalog_number FROM products').all().map(r => r.catalog_number)
  );
  db.close();

  const result = products.map(p => {
    const errors = [];
    if (!p.catalog_number) errors.push('缺少料號');
    if (!p.name_zh)        errors.push('缺少中文名稱');
    if (!VALID_CATEGORIES.includes(p.category)) errors.push(`類別無效：${p.category}`);

    return {
      ...p,
      _status: errors.length ? 'error' : existing.has(p.catalog_number) ? 'update' : 'new',
      _errors: errors,
      _category_label: CATEGORY_LABELS[p.category] || p.category,
    };
  });

  res.json({
    total: result.length,
    new_count:    result.filter(p => p._status === 'new').length,
    update_count: result.filter(p => p._status === 'update').length,
    error_count:  result.filter(p => p._status === 'error').length,
    products: result,
  });
});

// ── POST /api/admin/import/confirm ────────────────────────────
// 接受前端回傳的 products 陣列 → 寫入 DB
router.post('/confirm', (req, res) => {
  const { products, include_pricing } = req.body;
  if (!Array.isArray(products) || !products.length) {
    return res.status(400).json({ error: '無產品資料' });
  }

  const valid = products.filter(p =>
    p.catalog_number && p.name_zh && VALID_CATEGORIES.includes(p.category)
  );

  const db = getDb();

  const insertProduct = db.prepare(`
    INSERT INTO products (catalog_number, name_zh, name_en, category, is_base_unit, is_included_in_base, description, notes, sort_order)
    VALUES (@catalog_number, @name_zh, @name_en, @category, @is_base_unit, @is_included_in_base, @description, @notes, @sort_order)
    ON CONFLICT(catalog_number) DO UPDATE SET
      name_zh=excluded.name_zh, name_en=excluded.name_en, category=excluded.category,
      is_base_unit=excluded.is_base_unit, is_included_in_base=excluded.is_included_in_base,
      description=excluded.description, notes=excluded.notes, sort_order=excluded.sort_order
  `);

  const insertPricing = db.prepare(`
    INSERT INTO pricing (product_id, cost_price, min_sell_price, suggested_price, retail_price, currency)
    VALUES (?, ?, ?, ?, ?, 'TWD') ON CONFLICT DO NOTHING
  `);

  const updatePricing = db.prepare(`
    UPDATE pricing SET cost_price=?, min_sell_price=?, suggested_price=?, retail_price=?,
    updated_at=CURRENT_TIMESTAMP WHERE product_id=?
  `);

  const getId = db.prepare('SELECT id FROM products WHERE catalog_number=?');

  let inserted = 0, updated = 0;

  const doImport = db.transaction(() => {
    for (const p of valid) {
      const result = insertProduct.run({
        catalog_number: p.catalog_number, name_zh: p.name_zh, name_en: p.name_en || '',
        category: p.category, is_base_unit: p.is_base_unit ? 1 : 0,
        is_included_in_base: p.is_included_in_base ? 1 : 0,
        description: p.description || '', notes: p.notes || '', sort_order: p.sort_order ?? 99,
      });

      const isNew = result.lastInsertRowid > 0 && result.changes === 1;
      const productId = isNew ? result.lastInsertRowid : getId.get(p.catalog_number).id;

      if (isNew) {
        inserted++;
        insertPricing.run(productId, p.cost_price||0, p.min_sell_price||0, p.suggested_price||0, p.retail_price||0);
      } else {
        updated++;
        if (include_pricing) {
          updatePricing.run(p.cost_price||0, p.min_sell_price||0, p.suggested_price||0, p.retail_price||0, productId);
        }
      }
    }
  });

  doImport();
  db.close();

  res.json({ message: '匯入完成', inserted, updated });
});

module.exports = router;
