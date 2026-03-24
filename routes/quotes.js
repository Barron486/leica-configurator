const express = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

function generateQuoteNumber(db, prefix) {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;

  if (prefix) {
    // 計算該字軌的歷史總流水號（不限日期），+1 得下一號
    const row = db.prepare("SELECT COUNT(*) AS cnt FROM quotes WHERE quote_number LIKE ?").get(`${dateStr}_${prefix}%`);
    // 若同天已用完，改用全域計數避免碰撞
    const globalRow = db.prepare("SELECT COUNT(*) AS cnt FROM quotes WHERE quote_number LIKE ?").get(`%_${prefix}%`);
    const seq = String((globalRow?.cnt || 0) + 1).padStart(3, '0');
    return `${dateStr}_${prefix}${seq}`;
  } else {
    // 無字軌：沿用舊格式
    const rand = Math.floor(Math.random() * 9000) + 1000;
    return `${dateStr}_${rand}`;
  }
}

const REVIEWER_ROLES = ['admin', 'finance', 'management', 'gm'];

// 判斷此用戶是否有資格審核某報價
function canReview(db, userId, userRole, quote) {
  if (userRole === 'admin') return true;
  if (quote.status === 'pending_gm') return userRole === 'gm';
  if (quote.status === 'pending_pm') {
    // PM 只能審核包含其負責產品的報價
    if (userRole !== 'pm') return false;
    const hasProduct = db.prepare(`
      SELECT 1 FROM quote_items qi
      JOIN products p ON p.id = qi.product_id
      WHERE qi.quote_id = ? AND p.pm_user_id = ?
    `).get(quote.id, userId);
    return !!hasProduct;
  }
  if (quote.status === 'submitted') {
    // 審批鏈成員 or REVIEWER_ROLES
    if (REVIEWER_ROLES.includes(userRole)) return true;
    const inChain = db.prepare('SELECT 1 FROM approval_chain WHERE user_id=?').get(userId);
    return !!inChain;
  }
  return false;
}

// Get my quotes
router.get('/', (req, res) => {
  const { role, id: userId } = req.user;
  const db = getDb();
  let rows;

  if (role === 'admin' || REVIEWER_ROLES.includes(role)) {
    rows = db.prepare(`
      SELECT q.*, u.display_name AS sales_name FROM quotes q
      LEFT JOIN users u ON u.id = q.sales_user_id ORDER BY q.created_at DESC
    `).all();
  } else if (role === 'pm') {
    // PM 看見待自己審核的報價 + 自己已處理的
    rows = db.prepare(`
      SELECT DISTINCT q.*, u.display_name AS sales_name FROM quotes q
      LEFT JOIN users u ON u.id = q.sales_user_id
      LEFT JOIN quote_items qi ON qi.quote_id = q.id
      LEFT JOIN products p ON p.id = qi.product_id
      WHERE p.pm_user_id = ? OR q.sales_user_id = ?
      ORDER BY q.created_at DESC
    `).all(userId, userId);
  } else {
    rows = db.prepare(`
      SELECT q.*, u.display_name AS sales_name FROM quotes q
      LEFT JOIN users u ON u.id = q.sales_user_id
      WHERE q.sales_user_id = ? ORDER BY q.created_at DESC
    `).all(userId);
  }

  db.close();
  res.json(rows);
});

// Get quote detail with items
router.get('/:id', (req, res) => {
  const { role, id: userId } = req.user;
  const db = getDb();

  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '報價單不存在' }); }

  const allowed = role === 'admin' || REVIEWER_ROLES.includes(role) ||
    quote.sales_user_id === userId || canReview(db, userId, role, quote);
  if (!allowed) { db.close(); return res.status(403).json({ error: '無權限查看此報價單' }); }

  const items = db.prepare(`
    SELECT qi.*, pr.catalog_number, pr.name_zh, pr.name_en, pr.category
    FROM quote_items qi JOIN products pr ON pr.id = qi.product_id
    WHERE qi.quote_id = ?
  `).all(req.params.id);

  // 取得 sales 顯示名稱
  const salesUser = quote.sales_user_id
    ? db.prepare('SELECT display_name FROM users WHERE id=?').get(quote.sales_user_id)
    : null;

  db.close();
  res.json({ ...quote, items, sales_name: salesUser?.display_name });
});

// Create new quote
router.post('/', (req, res) => {
  const { role, id: userId } = req.user;
  const { customer_name, customer_org, customer_email, customer_phone, items } = req.body;

  if (!customer_name || !items || items.length === 0) {
    return res.status(400).json({ error: '請填寫客戶名稱與選擇產品' });
  }

  const db = getDb();
  const userRow = db.prepare('SELECT quote_prefix FROM users WHERE id=?').get(userId);
  const quoteNumber = generateQuoteNumber(db, userRow?.quote_prefix || '');

  const insertQuote = db.prepare(`
    INSERT INTO quotes (quote_number, customer_name, customer_org, customer_email, customer_phone, sales_user_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'draft')
  `);

  const insertItem = db.prepare(`
    INSERT INTO quote_items (quote_id, product_id, quantity, unit_price_snapshot, price_type)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = insertQuote.run(quoteNumber, customer_name, customer_org || '', customer_email || '', customer_phone || '', userId);
  const quoteId = result.lastInsertRowid;

  // Determine price type to snapshot
  const priceType = role === 'admin' ? 'suggested' : role === 'sales' ? 'suggested' : 'retail';

  for (const item of items) {
    const pricing = db.prepare('SELECT * FROM pricing WHERE product_id = ?').get(item.product_id);
    const price = pricing ? (priceType === 'suggested' ? pricing.suggested_price : pricing.retail_price) : 0;
    insertItem.run(quoteId, item.product_id, item.quantity || 1, price, priceType);
  }

  db.close();
  res.status(201).json({ quote_number: quoteNumber, id: quoteId });
});

// Submit quote
router.put('/:id/submit', (req, res) => {
  const { id: userId } = req.user;
  const db = getDb();

  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '報價單不存在' }); }
  const isAdmin = ['admin','super_admin'].includes(req.user.role);
  if (quote.sales_user_id !== userId && !isAdmin) { db.close(); return res.status(403).json({ error: '無權限' }); }
  if (quote.status !== 'draft') { db.close(); return res.status(400).json({ error: '只有草稿狀態可提交' }); }

  // 檢查是否有指派 PM 的產品在這張報價單中
  const pmUser = db.prepare(`
    SELECT DISTINCT p.pm_user_id FROM quote_items qi
    JOIN products p ON p.id = qi.product_id
    WHERE qi.quote_id = ? AND p.pm_user_id IS NOT NULL
    LIMIT 1
  `).get(req.params.id);

  const newStatus = pmUser ? 'pending_pm' : 'submitted';

  db.prepare('UPDATE quotes SET status=?, submitted_at=CURRENT_TIMESTAMP WHERE id=?').run(newStatus, req.params.id);
  db.close();
  const msg = pmUser ? '報價單已提交，待 PM 審核' : '報價單已提交，待管理部審核';
  res.json({ message: msg, status: newStatus });
});

// 審核：核准
router.put('/:id/approve', (req, res) => {
  const { role, id: userId } = req.user;
  const { admin_notes } = req.body;
  const db = getDb();
  const quote = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '不存在' }); }
  if (!canReview(db, userId, role, quote)) { db.close(); return res.status(403).json({ error: '無審核權限' }); }

  let nextStatus;
  if (quote.status === 'pending_pm') {
    // PM 核准後：檢查毛利率決定下一步
    const items = db.prepare(`
      SELECT qi.unit_price_snapshot * qi.quantity AS quoted, pr.cost_price * qi.quantity AS cost
      FROM quote_items qi JOIN pricing pr ON pr.product_id = qi.product_id WHERE qi.quote_id = ?
    `).all(req.params.id);
    const totalQuoted = items.reduce((s, r) => s + (r.quoted || 0), 0);
    const totalCost   = items.reduce((s, r) => s + (r.cost   || 0), 0);
    const margin = totalQuoted > 0 ? (1 - totalCost / totalQuoted) * 100 : 100;
    nextStatus = margin < 15 ? 'pending_gm' : 'submitted';
  } else if (quote.status === 'pending_gm') {
    nextStatus = 'submitted';
  } else {
    nextStatus = 'approved';
  }

  db.prepare("UPDATE quotes SET status=?, admin_notes=?, reviewer_role=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(nextStatus, admin_notes || '', role, req.params.id);
  db.close();
  const msgs = { pending_gm:'PM 已核准，報價單需總經理審核', submitted:'已核准，待管理部用印', approved:'報價單已核准' };
  res.json({ message: msgs[nextStatus] || '已核准', status: nextStatus });
});

// 審核：退回
router.put('/:id/reject', (req, res) => {
  const { role, id: userId } = req.user;
  const { admin_notes } = req.body;
  const db = getDb();
  const quote = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '不存在' }); }
  if (!canReview(db, userId, role, quote)) { db.close(); return res.status(403).json({ error: '無審核權限' }); }
  db.prepare("UPDATE quotes SET status='rejected', admin_notes=?, reviewer_role=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(admin_notes || '', role, req.params.id);
  db.close();
  res.json({ message: '報價單已退回' });
});

module.exports = router;
