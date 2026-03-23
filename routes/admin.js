const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database/schema');

const router = express.Router();

const REVIEWER_ROLES = ['admin', 'finance', 'management', 'gm'];

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: '需要管理員權限' });
  next();
}

function reviewerOnly(req, res, next) {
  if (!REVIEWER_ROLES.includes(req.user?.role)) return res.status(403).json({ error: '無審核權限' });
  next();
}

// ── Products ─────────────────────────────────────────────────
router.get('/products', adminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT pr.*, p.cost_price, p.min_sell_price, p.suggested_price, p.retail_price, p.currency, p.notes AS pricing_notes
    FROM products pr LEFT JOIN pricing p ON p.product_id = pr.id
    ORDER BY pr.sort_order
  `).all();
  db.close();
  res.json(rows);
});

router.post('/products', adminOnly, (req, res) => {
  const { catalog_number, name_zh, name_en, category, description, notes, sort_order } = req.body;
  if (!catalog_number || !name_zh || !category) {
    return res.status(400).json({ error: '料號、中文名稱、類別為必填' });
  }
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO products (catalog_number, name_zh, name_en, category, description, notes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(catalog_number, name_zh, name_en || '', category, description || '', notes || '', sort_order || 99);

  db.prepare('INSERT INTO pricing (product_id) VALUES (?)').run(result.lastInsertRowid);
  db.close();
  res.status(201).json({ id: result.lastInsertRowid });
});

router.put('/products/:id', adminOnly, (req, res) => {
  const { name_zh, name_en, category, description, notes, sort_order, active } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE products SET name_zh=?, name_en=?, category=?, description=?, notes=?, sort_order=?, active=?
    WHERE id=?
  `).run(name_zh, name_en || '', category, description || '', notes || '', sort_order, active ?? 1, req.params.id);
  db.close();
  res.json({ message: '已更新' });
});

// ── Pricing ──────────────────────────────────────────────────
router.put('/pricing/:product_id', adminOnly, (req, res) => {
  const { cost_price, min_sell_price, suggested_price, retail_price, currency, notes } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE pricing SET cost_price=?, min_sell_price=?, suggested_price=?, retail_price=?, currency=?, notes=?, updated_at=CURRENT_TIMESTAMP
    WHERE product_id=?
  `).run(
    cost_price || 0, min_sell_price || 0, suggested_price || 0, retail_price || 0,
    currency || 'TWD', notes || '', req.params.product_id
  );
  db.close();
  res.json({ message: '價格已更新' });
});

// ── Users ────────────────────────────────────────────────────
router.get('/users', adminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT id, username, role, display_name, email, created_at FROM users ORDER BY id').all();
  db.close();
  res.json(rows);
});

router.post('/users', adminOnly, (req, res) => {
  const { username, password, role, display_name, email } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: '帳號、密碼、角色為必填' });
  const hash = bcrypt.hashSync(password, 10);
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, role, display_name, email) VALUES (?,?,?,?,?)')
      .run(username, hash, role, display_name || username, email || '');
    db.close();
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    db.close();
    res.status(400).json({ error: '帳號已存在' });
  }
});

router.put('/users/:id', adminOnly, (req, res) => {
  const { role, display_name, email, password } = req.body;
  const db = getDb();
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET role=?, display_name=?, email=?, password_hash=? WHERE id=?')
      .run(role, display_name, email, hash, req.params.id);
  } else {
    db.prepare('UPDATE users SET role=?, display_name=?, email=? WHERE id=?')
      .run(role, display_name, email, req.params.id);
  }
  db.close();
  res.json({ message: '已更新' });
});

// ── Quotes (reviewer view with margin) ────────────────────────
router.get('/quotes', reviewerOnly, (req, res) => {
  const { status } = req.query;
  const db = getDb();
  let sql = `
    SELECT q.*,
      u.display_name AS sales_name,
      COALESCE(SUM(qi.unit_price_snapshot * qi.quantity), 0) AS total_quoted,
      COALESCE(SUM(pr.cost_price * qi.quantity), 0) AS total_cost,
      CASE WHEN COALESCE(SUM(qi.unit_price_snapshot * qi.quantity), 0) > 0
        THEN ROUND(100.0 * (1 - COALESCE(SUM(pr.cost_price * qi.quantity), 0) /
             COALESCE(SUM(qi.unit_price_snapshot * qi.quantity), 0)), 1)
        ELSE NULL END AS gross_margin_pct
    FROM quotes q
    LEFT JOIN users u ON u.id = q.sales_user_id
    LEFT JOIN quote_items qi ON qi.quote_id = q.id
    LEFT JOIN pricing pr ON pr.product_id = qi.product_id
  `;
  const params = [];
  if (status) { sql += ' WHERE q.status = ?'; params.push(status); }
  sql += ' GROUP BY q.id ORDER BY q.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

module.exports = router;
