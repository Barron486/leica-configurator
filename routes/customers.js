'use strict';

const express = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

const ADMIN_ROLES = ['admin', 'super_admin'];
function adminOnly(req, res, next) {
  if (ADMIN_ROLES.includes(req.user?.role)) return next();
  return res.status(403).json({ error: '無管理客戶權限' });
}

// ── GET /search?q=關鍵字 ─────────────────────────────────────
// 任何登入者都可搜尋（業務選客戶用）
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  const db = getDb();
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT id, name, org, phone, email, address, notes
    FROM customers
    WHERE name LIKE ? OR org LIKE ? OR phone LIKE ? OR email LIKE ?
    ORDER BY org, name
    LIMIT 20
  `).all(like, like, like, like);
  db.close();
  res.json(rows);
});

// ── GET / ──────────────────────────────────────────────────────
router.get('/', adminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, org, phone, email, address, notes, created_at, updated_at
    FROM customers ORDER BY org, name
  `).all();
  db.close();
  res.json(rows);
});

// ── POST / ────────────────────────────────────────────────────
router.post('/', adminOnly, (req, res) => {
  const { name, org, phone, email, address, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '請填寫客戶姓名' });

  const db = getDb();
  const r = db.prepare(`
    INSERT INTO customers (name, org, phone, email, address, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name.trim(), org||'', phone||'', email||'', address||'', notes||'');
  const row = db.prepare('SELECT * FROM customers WHERE id=?').get(r.lastInsertRowid);
  db.close();
  res.json(row);
});

// ── PUT /:id ──────────────────────────────────────────────────
router.put('/:id', adminOnly, (req, res) => {
  const { name, org, phone, email, address, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '請填寫客戶姓名' });

  const db = getDb();
  db.prepare(`
    UPDATE customers SET name=?, org=?, phone=?, email=?, address=?, notes=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(name.trim(), org||'', phone||'', email||'', address||'', notes||'', req.params.id);
  const row = db.prepare('SELECT * FROM customers WHERE id=?').get(req.params.id);
  db.close();
  if (!row) return res.status(404).json({ error: '找不到客戶' });
  res.json(row);
});

// ── DELETE /:id ───────────────────────────────────────────────
router.delete('/:id', adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
  db.close();
  res.json({ ok: true });
});

module.exports = router;
