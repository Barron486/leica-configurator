'use strict';
const express = require('express');
const { getDb } = require('../database/schema');
const router = express.Router();

function adminOnly(req, res, next) {
  if (!['admin','super_admin'].includes(req.user?.role)) return res.status(403).json({ error: '需要管理員權限' });
  next();
}

// ── Instrument Categories ──────────────────────────────────────

// GET /categories（任何登入者可讀，前端下拉選單用）
router.get('/categories', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM instrument_categories ORDER BY sort_order, label_zh').all();
  db.close();
  res.json(rows);
});

// POST /categories
router.post('/categories', adminOnly, (req, res) => {
  const { key, label_zh, label_en, description, sort_order } = req.body;
  if (!key?.trim() || !label_zh?.trim()) return res.status(400).json({ error: 'key 與中文名稱為必填' });
  if (!/^[a-z0-9_]+$/.test(key.trim())) return res.status(400).json({ error: 'key 只能使用英文小寫、數字、底線' });
  const db = getDb();
  try {
    db.prepare('INSERT INTO instrument_categories (key, label_zh, label_en, description, sort_order) VALUES (?,?,?,?,?)')
      .run(key.trim(), label_zh.trim(), label_en||'', description||'', sort_order||99);
    db.close();
    res.json({ ok: true });
  } catch(e) {
    db.close();
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: `Key "${key}" 已存在` });
    res.status(500).json({ error: e.message });
  }
});

// PUT /categories/:key
router.put('/categories/:key', adminOnly, (req, res) => {
  const { label_zh, label_en, description, sort_order } = req.body;
  if (!label_zh?.trim()) return res.status(400).json({ error: '中文名稱為必填' });
  const db = getDb();
  db.prepare('UPDATE instrument_categories SET label_zh=?, label_en=?, description=?, sort_order=? WHERE key=?')
    .run(label_zh.trim(), label_en||'', description||'', sort_order||99, req.params.key);
  db.close();
  res.json({ ok: true });
});

// DELETE /categories/:key
router.delete('/categories/:key', adminOnly, (req, res) => {
  const db = getDb();
  // 檢查是否有 BOM 使用此大類
  const inUse = db.prepare("SELECT COUNT(*) AS c FROM boms WHERE instrument_category=?").get(req.params.key);
  if (inUse.c > 0) {
    db.close();
    return res.status(400).json({ error: `此大類仍有 ${inUse.c} 個 BOM 使用，請先移除或重新分類` });
  }
  db.prepare('DELETE FROM instrument_categories WHERE key=?').run(req.params.key);
  db.close();
  res.json({ ok: true });
});

// Public: any logged-in user can get active catalog items
router.get('/public', (req, res) => {
  const db = getDb();
  const items = db.prepare(`SELECT * FROM catalog_items WHERE active=1 ORDER BY instrument_category, sort_order, name`).all();
  db.close();
  res.json(items);
});

// Admin: get all catalog items
router.get('/', adminOnly, (req, res) => {
  const db = getDb();
  const items = db.prepare(`SELECT * FROM catalog_items ORDER BY instrument_category, sort_order, name`).all();
  db.close();
  res.json(items);
});

// Admin: create
router.post('/', adminOnly, (req, res) => {
  const { name, instrument_category, subcategory, short_description, status, configurator_url, sort_order } = req.body;
  if (!name || !instrument_category) return res.status(400).json({ error: '名稱與類別為必填' });
  const db = getDb();
  try {
    const result = db.prepare(`INSERT INTO catalog_items (name, instrument_category, subcategory, short_description, status, configurator_url, sort_order) VALUES (?,?,?,?,?,?,?)`)
      .run(name, instrument_category, subcategory||'', short_description||'', status||'coming_soon', configurator_url||'', sort_order||99);
    db.close();
    res.status(201).json({ id: result.lastInsertRowid });
  } catch(e) { db.close(); res.status(500).json({ error: e.message }); }
});

// Admin: update
router.put('/:id', adminOnly, (req, res) => {
  const { name, instrument_category, subcategory, short_description, status, configurator_url, sort_order, active } = req.body;
  if (!name || !instrument_category) return res.status(400).json({ error: '名稱與類別為必填' });
  const db = getDb();
  try {
    db.prepare(`UPDATE catalog_items SET name=?, instrument_category=?, subcategory=?, short_description=?, status=?, configurator_url=?, sort_order=?, active=? WHERE id=?`)
      .run(name, instrument_category, subcategory||'', short_description||'', status||'coming_soon', configurator_url||'', sort_order||99, active??1, req.params.id);
    db.close();
    res.json({ message: '已更新' });
  } catch(e) { db.close(); res.status(500).json({ error: e.message }); }
});

// Admin: delete
router.delete('/:id', adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM catalog_items WHERE id=?').run(req.params.id);
  db.close();
  res.json({ message: '已刪除' });
});

module.exports = router;
