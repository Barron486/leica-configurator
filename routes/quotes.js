const express = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

function generateQuoteNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `LCA-${y}${m}${d}-${rand}`;
}

const REVIEWER_ROLES = ['admin', 'finance', 'management', 'gm'];

// Get my quotes (reviewers see all; others see own)
router.get('/', (req, res) => {
  const { role, id: userId } = req.user;
  const db = getDb();

  let rows;
  if (REVIEWER_ROLES.includes(role)) {
    rows = db.prepare(`
      SELECT q.*, u.display_name AS sales_name
      FROM quotes q LEFT JOIN users u ON u.id = q.sales_user_id
      ORDER BY q.created_at DESC
    `).all();
  } else {
    rows = db.prepare(`
      SELECT q.*, u.display_name AS sales_name
      FROM quotes q LEFT JOIN users u ON u.id = q.sales_user_id
      WHERE q.sales_user_id = ?
      ORDER BY q.created_at DESC
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
  if (!REVIEWER_ROLES.includes(role) && quote.sales_user_id !== userId) {
    db.close(); return res.status(403).json({ error: '無權限查看此報價單' });
  }

  const items = db.prepare(`
    SELECT qi.*, pr.catalog_number, pr.name_zh, pr.name_en, pr.category
    FROM quote_items qi JOIN products pr ON pr.id = qi.product_id
    WHERE qi.quote_id = ?
  `).all(req.params.id);

  db.close();
  res.json({ ...quote, items });
});

// Create new quote
router.post('/', (req, res) => {
  const { role, id: userId } = req.user;
  const { customer_name, customer_org, customer_email, customer_phone, items } = req.body;

  if (!customer_name || !items || items.length === 0) {
    return res.status(400).json({ error: '請填寫客戶名稱與選擇產品' });
  }

  const db = getDb();
  const quoteNumber = generateQuoteNumber();

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

// Submit quote (sales/customer → admin)
router.put('/:id/submit', (req, res) => {
  const { id: userId } = req.user;
  const db = getDb();

  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '報價單不存在' }); }
  if (quote.sales_user_id !== userId) { db.close(); return res.status(403).json({ error: '無權限' }); }
  if (quote.status !== 'draft') { db.close(); return res.status(400).json({ error: '只有草稿狀態可提交' }); }

  // 檢查是否有低於最低售價的品項
  const items = db.prepare(`
    SELECT qi.unit_price_snapshot, pr.min_sell_price
    FROM quote_items qi
    JOIN pricing pr ON pr.product_id = qi.product_id
    WHERE qi.quote_id = ?
  `).all(req.params.id);

  const belowMin = items.some(it => it.min_sell_price > 0 && it.unit_price_snapshot < it.min_sell_price);
  const newStatus = belowMin ? 'pending_gm' : 'submitted';

  db.prepare(`UPDATE quotes SET status = ?, submitted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, req.params.id);
  db.close();
  res.json({ message: belowMin ? '報價單已提交（需總經理審核）' : '報價單已提交', status: newStatus });
});

// 審核：核准（submitted → 審核角色；pending_gm → 只有 gm/admin）
router.put('/:id/approve', (req, res) => {
  const { role } = req.user;
  if (!REVIEWER_ROLES.includes(role)) return res.status(403).json({ error: '無審核權限' });
  const { admin_notes } = req.body;
  const db = getDb();
  const quote = db.prepare('SELECT status FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '不存在' }); }
  if (quote.status === 'pending_gm' && !['admin','gm'].includes(role)) {
    db.close(); return res.status(403).json({ error: '此報價單需要總經理核准' });
  }
  db.prepare("UPDATE quotes SET status='approved', admin_notes=?, reviewer_role=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(admin_notes || '', role, req.params.id);
  db.close();
  res.json({ message: '報價單已核准' });
});

// 審核：退回
router.put('/:id/reject', (req, res) => {
  const { role } = req.user;
  if (!REVIEWER_ROLES.includes(role)) return res.status(403).json({ error: '無審核權限' });
  const { admin_notes } = req.body;
  const db = getDb();
  const quote = db.prepare('SELECT status FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '不存在' }); }
  if (quote.status === 'pending_gm' && !['admin','gm'].includes(role)) {
    db.close(); return res.status(403).json({ error: '此報價單需要總經理處理' });
  }
  db.prepare("UPDATE quotes SET status='rejected', admin_notes=?, reviewer_role=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(admin_notes || '', role, req.params.id);
  db.close();
  res.json({ message: '報價單已退回' });
});

module.exports = router;
