'use strict';

const express  = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

const ADMIN_ROLES = ['admin', 'super_admin'];
const READONLY_ROLES = ['customer', 'demo'];

function adminOnly(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user?.role)) return res.status(403).json({ error: '需要管理員權限' });
  next();
}
function permBom(req, res, next) {
  if (ADMIN_ROLES.includes(req.user?.role)) return next();
  const db = getDb();
  const rp = db.prepare('SELECT manage_bom FROM role_permissions WHERE role=?').get(req.user?.role);
  db.close();
  if (!rp?.manage_bom) return res.status(403).json({ error: '無 BOM 管理權限' });
  next();
}
// customer / demo 只能看產品目錄，不能讀取 BOM 品項配置
function notReadOnly(req, res, next) {
  if (READONLY_ROLES.includes(req.user?.role)) return res.status(403).json({ error: '無存取權限' });
  next();
}

// ── GET /api/admin/boms/catalog ──────────────────────────────
// 靜態路由必須在 /:id 之前，否則 Express 會被 wildcard 攔截
// 公開（任何已登入用戶）：給產品目錄頁使用，回傳全部 BOM（含 coming_soon）
router.get('/catalog', (req, res) => {
  const db = getDb();
  const boms = db.prepare(`
    SELECT id, name, description, short_description, instrument_category, subcategory, active
    FROM boms WHERE instrument_category != '' ORDER BY instrument_category, name
  `).all();
  db.close();
  res.json(boms);
});

// ── GET /api/admin/boms/:id/config ───────────────────────────
// 任何已登入用戶：給配置報價頁讀取 BOM 品項（只回傳 product_id + quantity）
// 注意：此路由必須放在 /catalog 之後，避免 wildcard 攔截靜態路由
router.get('/:id/config', notReadOnly, (req, res) => {
  const db = getDb();
  const bom = db.prepare('SELECT id, name, short_description FROM boms WHERE id=? AND active=1').get(req.params.id);
  if (!bom) { db.close(); return res.status(404).json({ error: 'BOM 不存在' }); }
  const items = db.prepare(`
    SELECT bi.product_id, bi.quantity, bi.required,
      p.name_zh, p.catalog_number, p.category, p.description
    FROM bom_items bi
    JOIN products p ON p.id = bi.product_id
    WHERE bi.bom_id = ?
    ORDER BY p.sort_order, p.catalog_number
  `).all(req.params.id);
  db.close();
  res.json({ bom, items });
});

// ── GET /api/admin/boms ───────────────────────────────────────
// 取得所有 BOM，含品項數與成本/建議報價合計
router.get('/', adminOnly, (req, res) => {
  const db = getDb();
  const boms = db.prepare(`
    SELECT b.*,
      COUNT(DISTINCT bi.id) AS item_count,
      COALESCE(SUM(pr.cost_price      * bi.quantity), 0) AS total_cost,
      COALESCE(SUM(pr.suggested_price * bi.quantity), 0) AS total_suggested,
      COALESCE(SUM(pr.retail_price    * bi.quantity), 0) AS total_retail
    FROM boms b
    LEFT JOIN bom_items bi ON bi.bom_id = b.id
    LEFT JOIN pricing pr ON pr.product_id = bi.product_id
    GROUP BY b.id
    ORDER BY b.id
  `).all();
  db.close();
  res.json(boms);
});

// ── POST /api/admin/boms ──────────────────────────────────────
router.post('/', permBom, (req, res) => {
  const { name, description, instrument_category, subcategory, short_description, active } = req.body;
  if (!name) return res.status(400).json({ error: 'BOM 名稱為必填' });
  const db = getDb();
  try {
    const result = db.prepare(
      'INSERT INTO boms (name, description, instrument_category, subcategory, short_description, active) VALUES (?,?,?,?,?,?)'
    ).run(name, description || '', instrument_category || '', subcategory || '', short_description || '', active ?? 0);
    db.close();
    res.status(201).json({ id: result.lastInsertRowid });
  } catch(e) {
    db.close();
    console.error('BOM POST error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/admin/boms/:id ───────────────────────────────────
router.put('/:id', permBom, (req, res) => {
  const { name, description, active, instrument_category, subcategory, short_description } = req.body;
  if (!name) return res.status(400).json({ error: 'BOM 名稱為必填' });
  const db = getDb();
  try {
    db.prepare(
      'UPDATE boms SET name=?, description=?, active=?, instrument_category=?, subcategory=?, short_description=? WHERE id=?'
    ).run(name, description || '', active ?? 0, instrument_category || '', subcategory || '', short_description || '', req.params.id);
    db.close();
    res.json({ message: '已更新' });
  } catch(e) {
    db.close();
    console.error('BOM PUT error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/admin/boms/:id ────────────────────────────────
router.delete('/:id', permBom, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM boms WHERE id=?').run(req.params.id);
  db.close();
  res.json({ message: '已刪除' });
});

// ── GET /api/admin/boms/:id/items ────────────────────────────
// 取得單一 BOM 的所有品項（含產品詳情與價格）
router.get('/:id/items', adminOnly, (req, res) => {
  const db = getDb();
  const bom = db.prepare('SELECT * FROM boms WHERE id=?').get(req.params.id);
  if (!bom) { db.close(); return res.status(404).json({ error: 'BOM 不存在' }); }

  const items = db.prepare(`
    SELECT bi.id, bi.quantity, bi.notes,
      p.id AS product_id, p.catalog_number, p.name_zh, p.name_en, p.category,
      pr.cost_price, pr.min_sell_price, pr.suggested_price, pr.retail_price,
      bi.required
    FROM bom_items bi
    JOIN products p ON p.id = bi.product_id
    LEFT JOIN pricing pr ON pr.product_id = bi.product_id
    WHERE bi.bom_id = ?
    ORDER BY p.sort_order, p.catalog_number
  `).all(req.params.id);

  db.close();
  res.json({ bom, items });
});

// ── POST /api/admin/boms/:id/items ───────────────────────────
router.post('/:id/items', permBom, (req, res) => {
  const { product_id, quantity, notes, required } = req.body;
  if (!product_id) return res.status(400).json({ error: '產品為必填' });
  const db = getDb();
  try {
    const result = db.prepare(
      'INSERT INTO bom_items (bom_id, product_id, quantity, notes, required) VALUES (?,?,?,?,?)'
    ).run(req.params.id, product_id, quantity || 1, notes || '', required ?? 1);
    db.close();
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    db.close();
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '此產品已在 BOM 中' });
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/admin/boms/:id/items/:itemId ────────────────────
router.put('/:id/items/:itemId', permBom, (req, res) => {
  const { quantity, notes, required } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM bom_items WHERE id=? AND bom_id=?').get(req.params.itemId, req.params.id);
  if (!existing) { db.close(); return res.status(404).json({ error: '品項不存在' }); }
  db.prepare(
    'UPDATE bom_items SET quantity=?, notes=?, required=? WHERE id=? AND bom_id=?'
  ).run(
    quantity  ?? existing.quantity,
    notes     ?? existing.notes ?? '',
    required  !== undefined ? (required ? 1 : 0) : existing.required,
    req.params.itemId, req.params.id
  );
  db.close();
  res.json({ message: '已更新' });
});

// ── DELETE /api/admin/boms/:id/items/:itemId ─────────────────
router.delete('/:id/items/:itemId', permBom, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM bom_items WHERE id=? AND bom_id=?').run(req.params.itemId, req.params.id);
  db.close();
  res.json({ message: '已移除' });
});

module.exports = router;
