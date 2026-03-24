'use strict';
const express = require('express');
const { getDb } = require('../database/schema');
const router = express.Router();

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  next();
}

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
