const express = require('express');
const { getDb } = require('../database/schema');
const nodemailer = require('nodemailer');
const { logAudit, getIp } = require('../utils/audit');

const router = express.Router();

function createNotification(db, userId, type, title, body, link) {
  try {
    db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)')
      .run(userId, type, title, body, link || '');
  } catch(e) { console.error('createNotification error:', e.message); }
}

async function sendEmail(to, subject, text) {
  if (!process.env.SMTP_HOST || !to) return;
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
  } catch(e) { console.error('sendEmail error:', e.message); }
}

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

const REVIEWER_ROLES = ['admin', 'super_admin', 'finance', 'management', 'gm'];

// 自訂品項匯入資料庫：若有料號則找舊品更新定價，否則建立新品
function findOrCreateCustomProduct(db, name, catalogNumber, cost, suggestedPrice) {
  if (catalogNumber) {
    const existing = db.prepare('SELECT id FROM products WHERE catalog_number = ?').get(catalogNumber);
    if (existing) {
      const ep = db.prepare('SELECT id FROM pricing WHERE product_id = ?').get(existing.id);
      if (ep) {
        db.prepare('UPDATE pricing SET cost_price=?, suggested_price=?, updated_at=CURRENT_TIMESTAMP WHERE product_id=?')
          .run(cost || 0, suggestedPrice || 0, existing.id);
      } else {
        db.prepare('INSERT INTO pricing (product_id, cost_price, suggested_price) VALUES (?,?,?)')
          .run(existing.id, cost || 0, suggestedPrice || 0);
      }
      return existing.id;
    }
  }
  // 建立新產品（無料號則自動產生）
  const catNum = catalogNumber || `CUSTOM_${Date.now()}_${Math.floor(Math.random() * 9000) + 1000}`;
  let productId;
  try {
    const r = db.prepare(
      "INSERT INTO products (catalog_number, name_zh, category, active) VALUES (?, ?, 'custom', 1)"
    ).run(catNum, name);
    productId = r.lastInsertRowid;
  } catch(_e) {
    // 極少數料號碰撞：加隨機後綴重試
    const r2 = db.prepare(
      "INSERT INTO products (catalog_number, name_zh, category, active) VALUES (?, ?, 'custom', 1)"
    ).run(`${catNum}_${Math.floor(Math.random() * 9000) + 1000}`, name);
    productId = r2.lastInsertRowid;
  }
  db.prepare('INSERT INTO pricing (product_id, cost_price, suggested_price) VALUES (?,?,?)')
    .run(productId, cost || 0, suggestedPrice || 0);
  return productId;
}

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
      LEFT JOIN users u ON u.id = q.sales_user_id
      WHERE q.deleted_at IS NULL ORDER BY q.created_at DESC
    `).all();
  } else if (role === 'pm') {
    // PM 看見待自己審核的報價 + 自己已處理的
    rows = db.prepare(`
      SELECT DISTINCT q.*, u.display_name AS sales_name FROM quotes q
      LEFT JOIN users u ON u.id = q.sales_user_id
      LEFT JOIN quote_items qi ON qi.quote_id = q.id
      LEFT JOIN products p ON p.id = qi.product_id
      WHERE (p.pm_user_id = ? OR q.sales_user_id = ?) AND q.deleted_at IS NULL
      ORDER BY q.created_at DESC
    `).all(userId, userId);
  } else {
    rows = db.prepare(`
      SELECT q.*, u.display_name AS sales_name FROM quotes q
      LEFT JOIN users u ON u.id = q.sales_user_id
      WHERE q.sales_user_id = ? AND q.deleted_at IS NULL ORDER BY q.created_at DESC
    `).all(userId);
  }

  db.close();
  res.json(rows);
});

// 業務端：取得自己的報價單
router.get('/my', (req, res) => {
  const { id: userId } = req.user;
  const db = getDb();
  const quotes = db.prepare(`
    SELECT q.*, u.display_name AS sales_name
    FROM quotes q
    LEFT JOIN users u ON u.id = q.sales_user_id
    WHERE q.sales_user_id = ? AND q.deleted_at IS NULL
    ORDER BY q.created_at DESC
  `).all(userId);
  db.close();
  res.json(quotes);
});

// 管理員：取得回收桶中的報價單
router.get('/trash', (req, res) => {
  const { role } = req.user;
  if (!['admin','super_admin'].includes(role)) return res.status(403).json({ error: '需要管理員權限' });
  const db = getDb();
  const rows = db.prepare(`
    SELECT q.*, u.display_name AS sales_name, d.display_name AS deleted_by_name
    FROM quotes q
    LEFT JOIN users u ON u.id = q.sales_user_id
    LEFT JOIN users d ON d.id = q.deleted_by
    WHERE q.deleted_at IS NOT NULL
    ORDER BY q.deleted_at DESC
  `).all();
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
    FROM quote_items qi LEFT JOIN products pr ON pr.id = qi.product_id
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
    INSERT INTO quote_items (quote_id, product_id, custom_item_name, custom_catalog_number, quantity, unit_price_snapshot, price_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insertQuote.run(quoteNumber, customer_name, customer_org || '', customer_email || '', customer_phone || '', userId);
  const quoteId = result.lastInsertRowid;

  // Determine price type to snapshot
  const priceType = role === 'admin' ? 'suggested' : role === 'sales' ? 'suggested' : 'retail';

  for (const item of items) {
    if (item.product_id) {
      const pricing = db.prepare('SELECT * FROM pricing WHERE product_id = ?').get(item.product_id);
      const price = pricing ? (priceType === 'suggested' ? pricing.suggested_price : pricing.retail_price) : 0;
      insertItem.run(quoteId, item.product_id, '', '', item.quantity || 1, price, priceType);
    } else if (item.custom_name) {
      const unitPrice = parseFloat(item.unit_price) || 0;
      const cost = parseFloat(item.custom_cost) || 0;
      const productId = findOrCreateCustomProduct(db, item.custom_name, item.custom_catalog_number || '', cost, unitPrice);
      insertItem.run(quoteId, productId, item.custom_name, item.custom_catalog_number || '', item.quantity || 1, unitPrice, 'custom');
    }
  }

  db.close();
  logAudit({ userId: req.user.id, username: req.user.username, role: req.user.role, action: 'create_quote', resource: 'quotes', resourceId: quoteId, detail: { quote_number: quoteNumber, customer: customer_name }, ip: getIp(req) });
  res.status(201).json({ quote_number: quoteNumber, id: quoteId });
});

// 更新草稿（客戶資料 + 品項全替換）
router.put('/:id', (req, res) => {
  const { role, id: userId } = req.user;
  const { customer_name, customer_org, customer_email, customer_phone, items } = req.body;
  if (!customer_name || !items || items.length === 0) {
    return res.status(400).json({ error: '請填寫客戶名稱與選擇產品' });
  }
  const db = getDb();
  const quote = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '報價單不存在' }); }
  const isAdmin = ['admin', 'super_admin'].includes(role);
  if (quote.sales_user_id !== userId && !isAdmin) { db.close(); return res.status(403).json({ error: '無權限' }); }
  if (quote.status !== 'draft') { db.close(); return res.status(400).json({ error: '只有草稿可以修改' }); }

  const priceType = (role === 'admin' || role === 'sales') ? 'suggested' : 'retail';
  const insertItem = db.prepare(`
    INSERT INTO quote_items (quote_id, product_id, custom_item_name, custom_catalog_number, quantity, unit_price_snapshot, price_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const doUpdate = db.transaction(() => {
    db.prepare('UPDATE quotes SET customer_name=?, customer_org=?, customer_email=?, customer_phone=? WHERE id=?')
      .run(customer_name, customer_org || '', customer_email || '', customer_phone || '', req.params.id);
    db.prepare('DELETE FROM quote_items WHERE quote_id=?').run(req.params.id);
    for (const item of items) {
      if (item.product_id) {
        const pricing = db.prepare('SELECT * FROM pricing WHERE product_id=?').get(item.product_id);
        const price = item.unit_price ?? (pricing ? (priceType === 'suggested' ? pricing.suggested_price : pricing.retail_price) : 0);
        insertItem.run(req.params.id, item.product_id, '', '', item.quantity || 1, price, priceType);
      } else if (item.custom_name) {
        const unitPrice2 = parseFloat(item.unit_price) || 0;
        const cost2 = parseFloat(item.custom_cost) || 0;
        const productId2 = findOrCreateCustomProduct(db, item.custom_name, item.custom_catalog_number || '', cost2, unitPrice2);
        insertItem.run(req.params.id, productId2, item.custom_name, item.custom_catalog_number || '', item.quantity || 1, unitPrice2, 'custom');
      }
    }
  });
  doUpdate();
  db.close();
  res.json({ message: '草稿已更新' });
});

// Submit quote
router.put('/:id/submit', async (req, res) => {
  const { id: userId } = req.user;
  const { case_notes } = req.body;
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

  db.prepare('UPDATE quotes SET status=?, submitted_at=CURRENT_TIMESTAMP, case_notes=? WHERE id=?')
    .run(newStatus, case_notes || '', req.params.id);

  // 通知審批人員
  const salesUser = db.prepare('SELECT display_name FROM users WHERE id=?').get(quote.sales_user_id);
  const salesName = salesUser?.display_name || '業務';
  const notifTitle = `新報價單待審核：${quote.quote_number}`;
  const notifBody = `${salesName} 提交了報價單 ${quote.quote_number}，客戶：${quote.customer_name}。${case_notes ? '案件說明：' + case_notes : ''}`;

  let approvers = [];
  if (newStatus === 'pending_pm' && pmUser) {
    approvers = [db.prepare('SELECT id, email, display_name FROM users WHERE id=?').get(pmUser.pm_user_id)].filter(Boolean);
  } else {
    // 通知審批鏈所有成員
    approvers = db.prepare(`
      SELECT u.id, u.email, u.display_name FROM approval_chain ac
      JOIN users u ON u.id = ac.user_id ORDER BY ac.step_order
    `).all();
  }

  for (const ap of approvers) {
    createNotification(db, ap.id, 'quote_submitted', notifTitle, notifBody, '/admin.html');
  }

  db.close();
  logAudit({ userId: req.user.id, username: req.user.username, role: req.user.role, action: 'submit_quote', resource: 'quotes', resourceId: quote.id, detail: { quote_number: quote.quote_number, status: newStatus }, ip: getIp(req) });

  // 非同步發送 email（不阻塞回應）
  for (const ap of approvers) {
    sendEmail(ap.email, `[Leica] ${notifTitle}`, notifBody).catch(() => {});
  }

  const msg = pmUser ? '報價單已提交，待 PM 審核' : '報價單已提交，待管理部審核';
  res.json({ message: msg, status: newStatus });
});

// 撤回報價單（回到草稿）
router.put('/:id/withdraw', (req, res) => {
  const { id: userId } = req.user;
  const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
  const db = getDb();

  const quote = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '報價單不存在' }); }
  if (quote.sales_user_id !== userId && !isAdmin) { db.close(); return res.status(403).json({ error: '無權限' }); }

  const withdrawable = ['submitted', 'pending_pm', 'pending_gm'];
  if (!withdrawable.includes(quote.status)) {
    db.close();
    return res.status(400).json({ error: '此狀態無法撤回' });
  }

  db.prepare('UPDATE quotes SET status=?, submitted_at=NULL WHERE id=?').run('draft', req.params.id);
  db.close();
  logAudit({ userId: req.user.id, username: req.user.username, role: req.user.role, action: 'withdraw_quote', resource: 'quotes', resourceId: quote.id, detail: { quote_number: quote.quote_number }, ip: getIp(req) });
  res.json({ message: '報價單已撤回，可重新修改後提交' });
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

  // 通知業務
  const salesUser2 = db.prepare('SELECT id, email, display_name FROM users WHERE id=?').get(quote.sales_user_id);
  if (salesUser2) {
    const statusLabels = { pending_gm:'轉請總經理審核', submitted:'已核准，待管理部用印', approved:'報價單已核准！' };
    const nTitle = `報價單 ${quote.quote_number} ${statusLabels[nextStatus] || '已更新'}`;
    const nBody = `您的報價單 ${quote.quote_number}（${quote.customer_name}）已被核准。${admin_notes ? '備註：' + admin_notes : ''}`;
    createNotification(db, salesUser2.id, 'quote_approved', nTitle, nBody, '/quotes.html');
    db.close();
    sendEmail(salesUser2.email, `[Leica] ${nTitle}`, nBody).catch(() => {});
  } else {
    db.close();
  }

  logAudit({ userId, username: req.user.username, role, action: 'approve_quote', resource: 'quotes', resourceId: quote.id, detail: { quote_number: quote.quote_number, next_status: nextStatus, admin_notes }, ip: getIp(req) });
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

  // 通知業務
  const salesReject = db.prepare('SELECT id, email FROM users WHERE id=?').get(quote.sales_user_id);
  if (salesReject) {
    const rTitle = `報價單 ${quote.quote_number} 已退回`;
    const rBody = `您的報價單 ${quote.quote_number}（${quote.customer_name}）已被退回。${admin_notes ? '退回原因：' + admin_notes : ''}`;
    createNotification(db, salesReject.id, 'quote_rejected', rTitle, rBody, '/quotes.html');
    db.close();
    sendEmail(salesReject.email, `[Leica] ${rTitle}`, rBody).catch(() => {});
  } else {
    db.close();
  }

  logAudit({ userId, username: req.user.username, role, action: 'reject_quote', resource: 'quotes', resourceId: quote.id, detail: { quote_number: quote.quote_number, admin_notes }, ip: getIp(req) });
  res.json({ message: '報價單已退回' });
});

// 刪除報價單（軟刪除，放入回收桶）
router.delete('/:id', (req, res) => {
  const { role, id: userId } = req.user;
  const db = getDb();
  const quote = db.prepare('SELECT * FROM quotes WHERE id=? AND deleted_at IS NULL').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '報價單不存在' }); }
  const isAdmin = ['admin','super_admin'].includes(role);
  if (!isAdmin && (quote.sales_user_id !== userId || quote.status !== 'draft')) {
    db.close(); return res.status(403).json({ error: '只能刪除自己的草稿報價單' });
  }
  db.prepare('UPDATE quotes SET deleted_at=CURRENT_TIMESTAMP, deleted_by=? WHERE id=?').run(userId, req.params.id);
  db.close();
  logAudit({ userId, username: req.user.username, role, action: 'delete_quote', resource: 'quotes', resourceId: quote.id, detail: { quote_number: quote.quote_number, status: quote.status }, ip: getIp(req) });
  res.json({ message: '已移至回收桶' });
});

// 從回收桶還原報價單（管理員限定）
router.put('/:id/restore', (req, res) => {
  const { role, id: userId } = req.user;
  if (!['admin','super_admin'].includes(role)) return res.status(403).json({ error: '需要管理員權限' });
  const db = getDb();
  const quote = db.prepare('SELECT * FROM quotes WHERE id=? AND deleted_at IS NOT NULL').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '回收桶中找不到此報價單' }); }
  db.prepare('UPDATE quotes SET deleted_at=NULL, deleted_by=NULL WHERE id=?').run(req.params.id);
  db.close();
  logAudit({ userId, username: req.user.username, role, action: 'restore_quote', resource: 'quotes', resourceId: quote.id, detail: { quote_number: quote.quote_number }, ip: getIp(req) });
  res.json({ message: '報價單已還原' });
});

// 永久刪除（管理員限定，不可復原）
router.delete('/:id/purge', (req, res) => {
  const { role, id: userId } = req.user;
  if (!['admin','super_admin'].includes(role)) return res.status(403).json({ error: '需要管理員權限' });
  const db = getDb();
  const quote = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id);
  if (!quote) { db.close(); return res.status(404).json({ error: '報價單不存在' }); }
  db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id);
  db.close();
  logAudit({ userId, username: req.user.username, role, action: 'purge_quote', resource: 'quotes', resourceId: quote.id, detail: { quote_number: quote.quote_number }, ip: getIp(req) });
  res.json({ message: '已永久刪除' });
});

module.exports = router;
