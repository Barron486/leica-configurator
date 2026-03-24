const express = require('express');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');
const { getDb } = require('../database/schema');

const router = express.Router();

const REVIEWER_ROLES = ['admin', 'super_admin', 'finance', 'management', 'gm', 'pm'];
const ADMIN_ROLES    = ['admin', 'super_admin'];

function adminOnly(req, res, next) {
  if (!ADMIN_ROLES.includes(req.user?.role)) return res.status(403).json({ error: '需要管理員權限' });
  next();
}
function superAdminOnly(req, res, next) {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ error: '需要超級管理員權限' });
  next();
}

// 依 role_permissions 表檢查功能權限（admin/super_admin 直接放行）
function perm(key) {
  return (req, res, next) => {
    if (ADMIN_ROLES.includes(req.user?.role)) return next();
    const db = getDb();
    const rp = db.prepare('SELECT * FROM role_permissions WHERE role=?').get(req.user?.role);
    db.close();
    if (!rp || !rp[key]) return res.status(403).json({ error: '無此功能權限' });
    next();
  };
}

function reviewerOnly(req, res, next) {
  const role = req.user?.role;
  if (!REVIEWER_ROLES.includes(role)) {
    // 也允許審批鏈成員
    const db = require('../database/schema').getDb();
    const inChain = db.prepare('SELECT 1 FROM approval_chain WHERE user_id=?').get(req.user?.id);
    db.close();
    if (!inChain) return res.status(403).json({ error: '無審核權限' });
  }
  next();
}

// ── Brands ───────────────────────────────────────────────────
router.get('/brands', adminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM brands ORDER BY name').all();
  db.close();
  res.json(rows);
});

router.post('/brands', adminOnly, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: '品牌名稱為必填' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO brands (name, description) VALUES (?,?)').run(name, description || '');
    db.close();
    res.status(201).json({ id: r.lastInsertRowid });
  } catch(e) {
    db.close();
    res.status(400).json({ error: '品牌名稱已存在' });
  }
});

router.put('/brands/:id', adminOnly, (req, res) => {
  const { name, description, active } = req.body;
  const db = getDb();
  db.prepare('UPDATE brands SET name=?, description=?, active=? WHERE id=?')
    .run(name, description || '', active ?? 1, req.params.id);
  db.close();
  res.json({ message: '已更新' });
});

router.delete('/brands/:id', adminOnly, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM brands WHERE id=?').run(req.params.id);
  db.close();
  res.json({ message: '已刪除' });
});

// ── User Permissions ──────────────────────────────────────────
router.get('/permissions', adminOnly, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, display_name, role FROM users ORDER BY id').all();
  const brands = db.prepare('SELECT * FROM brands WHERE active=1 ORDER BY name').all();
  const result = users.map(u => {
    const brandIds = db.prepare('SELECT brand_id FROM user_brand_permissions WHERE user_id=?').all(u.id).map(r => r.brand_id);
    const pp = db.prepare('SELECT can_see_cost, can_see_min_price FROM user_price_permissions WHERE user_id=?').get(u.id) || { can_see_cost: 0, can_see_min_price: 0 };
    return { ...u, brand_ids: brandIds, can_see_cost: pp.can_see_cost, can_see_min_price: pp.can_see_min_price };
  });
  db.close();
  res.json({ users: result, brands });
});

router.put('/permissions/:userId', adminOnly, (req, res) => {
  const userId = req.params.userId;
  const { brand_ids, can_see_cost, can_see_min_price } = req.body;
  const db = getDb();
  const update = db.transaction(() => {
    db.prepare('DELETE FROM user_brand_permissions WHERE user_id=?').run(userId);
    for (const brandId of (brand_ids || [])) {
      db.prepare('INSERT OR IGNORE INTO user_brand_permissions (user_id, brand_id) VALUES (?,?)').run(userId, brandId);
    }
    db.prepare('INSERT OR REPLACE INTO user_price_permissions (user_id, can_see_cost, can_see_min_price) VALUES (?,?,?)').run(userId, can_see_cost ? 1 : 0, can_see_min_price ? 1 : 0);
  });
  update();
  db.close();
  res.json({ message: '權限已更新' });
});

// ── Products ─────────────────────────────────────────────────
router.get('/products', reviewerOnly, (req, res) => {
  const { role, id: userId } = req.user;
  const db = getDb();

  // Brand filter (skip for admin)
  const brandPerms = role !== 'admin'
    ? db.prepare('SELECT brand_id FROM user_brand_permissions WHERE user_id=?').all(userId).map(r => r.brand_id)
    : [];
  const hasBrandFilter = brandPerms.length > 0;

  const BASE_SELECT = `
    SELECT pr.*, p.cost_price, p.min_sell_price, p.suggested_price, p.retail_price, p.currency, p.notes AS pricing_notes,
      u.display_name AS pm_name, b.name AS brand_name
    FROM products pr
    LEFT JOIN pricing p ON p.product_id = pr.id
    LEFT JOIN users u ON u.id = pr.pm_user_id
    LEFT JOIN brands b ON b.id = pr.brand_id
  `;

  let rows;
  if (role === 'pm') {
    rows = db.prepare(BASE_SELECT + ' WHERE pr.pm_user_id = ? ORDER BY pr.sort_order').all(userId);
  } else if (hasBrandFilter) {
    const ph = brandPerms.map(() => '?').join(',');
    rows = db.prepare(BASE_SELECT + ` WHERE pr.brand_id IN (${ph}) ORDER BY pr.sort_order`).all(...brandPerms);
  } else {
    rows = db.prepare(BASE_SELECT + ' ORDER BY pr.sort_order').all();
  }

  // Price field visibility
  const pp = role === 'admin'
    ? { can_see_cost: 1, can_see_min_price: 1 }
    : (db.prepare('SELECT can_see_cost, can_see_min_price FROM user_price_permissions WHERE user_id=?').get(userId) || { can_see_cost: 0, can_see_min_price: 0 });

  db.close();

  const result = rows.map(r => {
    const out = { ...r };
    if (!pp.can_see_cost) delete out.cost_price;
    if (!pp.can_see_min_price) delete out.min_sell_price;
    return out;
  });
  res.json(result);
});

router.post('/products', perm('manage_products'), (req, res) => {
  const { catalog_number, name_zh, name_en, category, description, notes, sort_order, pm_user_id } = req.body;
  if (!catalog_number || !name_zh || !category) {
    return res.status(400).json({ error: '料號、中文名稱、類別為必填' });
  }
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO products (catalog_number, name_zh, name_en, category, description, notes, sort_order, pm_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(catalog_number, name_zh, name_en || '', category, description || '', notes || '', sort_order || 99, pm_user_id || null);

  db.prepare('INSERT INTO pricing (product_id) VALUES (?)').run(result.lastInsertRowid);
  db.close();
  res.status(201).json({ id: result.lastInsertRowid });
});

// ── PATCH /products/:id/active — 快速切換啟用狀態（停用按鈕專用）────
router.patch('/products/:id/active', perm('manage_products'), (req, res) => {
  const { active } = req.body;
  if (active === undefined) return res.status(400).json({ error: '缺少 active 參數' });
  const db = getDb();
  db.prepare('UPDATE products SET active=? WHERE id=?').run(active ? 1 : 0, req.params.id);
  db.close();
  res.json({ message: '已更新' });
});

router.put('/products/:id', perm('manage_products'), (req, res) => {
  const { name_zh, name_en, category, description, notes, sort_order, active, pm_user_id } = req.body;
  const db = getDb();
  db.prepare(`
    UPDATE products SET name_zh=?, name_en=?, category=?, description=?, notes=?, sort_order=?, active=?, pm_user_id=?
    WHERE id=?
  `).run(name_zh, name_en || '', category, description || '', notes || '', sort_order, active ?? 1, pm_user_id || null, req.params.id);
  db.close();
  res.json({ message: '已更新' });
});

// ── Pricing ──────────────────────────────────────────────────
router.put('/pricing/:product_id', perm('manage_pricing'), (req, res) => {
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
router.get('/users', perm('manage_users'), (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT id, username, role, display_name, email, quote_prefix, created_at FROM users ORDER BY id').all();
  db.close();
  res.json(rows);
});

router.post('/users', perm('manage_users'), (req, res) => {
  const { username, password, role, display_name, email, quote_prefix } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: '帳號、密碼、角色為必填' });
  const hash = bcrypt.hashSync(password, 10);
  const db = getDb();
  try {
    const result = db.prepare('INSERT INTO users (username, password_hash, role, display_name, email, quote_prefix) VALUES (?,?,?,?,?,?)')
      .run(username, hash, role, display_name || username, email || '', (quote_prefix || '').toUpperCase());
    db.close();
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    db.close();
    res.status(400).json({ error: '帳號已存在' });
  }
});

router.put('/users/:id', perm('manage_users'), (req, res) => {
  const { role, display_name, email, password, quote_prefix } = req.body;
  const prefix = (quote_prefix || '').toUpperCase();
  const db = getDb();
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET role=?, display_name=?, email=?, password_hash=?, quote_prefix=? WHERE id=?')
      .run(role, display_name, email, hash, prefix, req.params.id);
  } else {
    db.prepare('UPDATE users SET role=?, display_name=?, email=?, quote_prefix=? WHERE id=?')
      .run(role, display_name, email, prefix, req.params.id);
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

// ── Role Permissions ─────────────────────────────────────────

// 取得當前用戶角色的權限（任何已登入用戶可用）
router.get('/role-permissions/me', (req, res) => {
  const db = getDb();
  const rp = db.prepare('SELECT * FROM role_permissions WHERE role=?').get(req.user?.role);
  db.close();
  res.json(rp || {});
});

router.get('/role-permissions', adminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM role_permissions ORDER BY role').all();
  db.close();
  res.json(rows);
});

router.put('/role-permissions/:role', adminOnly, (req, res) => {
  const { role } = req.params;
  const { import_products, manage_approval, manage_bom, manage_users, manage_products, manage_pricing, manage_quotes } = req.body;
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO role_permissions
    (role, import_products, manage_approval, manage_bom, manage_users, manage_products, manage_pricing, manage_quotes)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(role,
      import_products  ? 1 : 0,
      manage_approval  ? 1 : 0,
      manage_bom       ? 1 : 0,
      manage_users     ? 1 : 0,
      manage_products  ? 1 : 0,
      manage_pricing   ? 1 : 0,
      manage_quotes    ? 1 : 0
    );
  db.close();
  res.json({ message: '已更新' });
});

// ── Export Products to Excel ──────────────────────────────────
router.get('/export/products', adminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT p.catalog_number, p.name_zh, p.name_en, p.category, p.sort_order,
      p.active, p.description, p.notes,
      COALESCE(pr.cost_price, 0)      AS cost_price,
      COALESCE(pr.min_sell_price, 0)  AS min_sell_price,
      COALESCE(pr.suggested_price, 0) AS suggested_price,
      COALESCE(pr.retail_price, 0)    AS retail_price,
      pr.currency, pr.notes AS pricing_notes
    FROM products p
    LEFT JOIN pricing pr ON pr.product_id = p.id
    ORDER BY p.sort_order, p.catalog_number
  `).all();
  db.close();

  const headers = ['料號','中文名稱','英文名稱','類別','排序','啟用','說明','備註','成本價','最低售價','建議報價','零售價','幣別','定價備註'];
  const data = rows.map(r => [
    r.catalog_number, r.name_zh, r.name_en, r.category, r.sort_order,
    r.active ? '是' : '否', r.description, r.notes,
    r.cost_price, r.min_sell_price, r.suggested_price, r.retail_price,
    r.currency, r.pricing_notes,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map((_, i) => ({ wch: [12,20,20,16,6,6,30,30,12,12,12,12,6,20][i] || 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '產品清單');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="products.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── API Settings (super_admin only) ──────────────────────────
router.get('/api-settings', superAdminOnly, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value, description, updated_at FROM api_settings ORDER BY key').all();
  db.close();
  res.json(rows);
});

router.put('/api-settings/:key', superAdminOnly, (req, res) => {
  const { value } = req.body;
  const db = getDb();
  db.prepare(`
    INSERT INTO api_settings (key, value, updated_at, updated_by)
    VALUES (?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).run(req.params.key, value || '', req.user.id);
  db.close();
  res.json({ message: '已更新' });
});

module.exports = router;
