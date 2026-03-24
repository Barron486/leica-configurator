'use strict';

const express  = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  next();
}

// ── GET /api/admin/boms/catalog ──────────────────────────────
// 公開（任何已登入用戶）：給產品目錄頁使用，只回傳啟用中的 BOM
router.get('/catalog', (req, res) => {
  const db = getDb();
  const boms = db.prepare(`
    SELECT id, name, description, short_description, instrument_category
    FROM boms WHERE active=1 AND instrument_category != '' ORDER BY instrument_category, name
  `).all();
  db.close();
  res.json(boms);
});

// ── GET /api/admin/boms ───────────────────────────────────────
// 取得所有 BOM，含品項數與成本/建議報價合計
router.get('/', adminOnly, (req, res) => {
  const db = getDb();
  const boms = db.prepare(`
    SELECT b.*,
      COUNT(bi.id) AS item_count,
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
router.post('/', adminOnly, (req, res) => {
  const { name, description, instrument_category, short_description } = req.body;
  if (!name) return res.status(400).json({ error: 'BOM 名稱為必填' });
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO boms (name, description, instrument_category, short_description) VALUES (?,?,?,?)'
  ).run(name, description || '', instrument_category || '', short_description || '');
  db.close();
  res.status(201).json({ id: result.lastInsertRowid });
});

// ── PUT /api/admin/boms/:id ───────────────────────────────────
router.put('/:id', adminOnly, (req, res) => {
  const { name, description, active, instrument_category, short_description } = req.body;
  if (!name) return res.status(400).json({ error: 'BOM 名稱為必填' });
  const db = getDb();
  db.prepare(
    'UPDATE boms SET name=?, description=?, active=?, instrument_category=?, short_description=? WHERE id=?'
  ).run(name, description || '', active ?? 1, instrument_category || '', short_description || '', req.params.id);
  db.close();
  res.json({ message: '已更新' });
});

// ── DELETE /api/admin/boms/:id ────────────────────────────────
router.delete('/:id', adminOnly, (req, res) => {
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
      pr.cost_price, pr.min_sell_price, pr.suggested_price, pr.retail_price
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
router.post('/:id/items', adminOnly, (req, res) => {
  const { product_id, quantity, notes } = req.body;
  if (!product_id) return res.status(400).json({ error: '產品為必填' });
  const db = getDb();
  try {
    const result = db.prepare(
      'INSERT INTO bom_items (bom_id, product_id, quantity, notes) VALUES (?,?,?,?)'
    ).run(req.params.id, product_id, quantity || 1, notes || '');
    db.close();
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    db.close();
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '此產品已在 BOM 中' });
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/admin/boms/:id/items/:itemId ────────────────────
router.put('/:id/items/:itemId', adminOnly, (req, res) => {
  const { quantity, notes } = req.body;
  const db = getDb();
  db.prepare(
    'UPDATE bom_items SET quantity=?, notes=? WHERE id=? AND bom_id=?'
  ).run(quantity || 1, notes || '', req.params.itemId, req.params.id);
  db.close();
  res.json({ message: '已更新' });
});

// ── DELETE /api/admin/boms/:id/items/:itemId ─────────────────
router.delete('/:id/items/:itemId', adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM bom_items WHERE id=? AND bom_id=?').run(req.params.itemId, req.params.id);
  db.close();
  res.json({ message: '已移除' });
});

module.exports = router;
