'use strict';

const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../database/schema');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CUSTOMER_SYSTEM_PROMPT = `你是客戶資料分析師。
分析 Excel 客戶資料，對應到以下資料庫欄位格式。

欄位定義：
- name（聯絡人姓名, 必填）
- org（單位 / 醫院名稱, 選填）
- phone（聯絡電話, 選填）
- email（電子郵件, 選填）
- address（地址, 選填）
- notes（備註, 選填）

回傳規則：
1. 只輸出純 JSON 陣列，不加任何說明或 markdown
2. 每筆必須包含 name
3. 無法判斷的欄位直接省略
4. 電話欄位保留原始格式`;

const router = express.Router();

const ADMIN_ROLES = ['admin', 'super_admin'];
function adminOnly(req, res, next) {
  if (ADMIN_ROLES.includes(req.user?.role)) return next();
  return res.status(403).json({ error: '無管理客戶權限' });
}

function getApiKey() {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM api_settings WHERE key='anthropic_api_key'").get();
    db.close();
    return row?.value || '';
  } catch { return ''; }
}

// ── POST /import/preview ──────────────────────────────────────
// 放在 POST / 之前，避免 Express v5 路由歧義
router.post('/import/preview', adminOnly, async (req, res) => {
  // 先用 Promise 包裝 multer，確保錯誤能被捕捉
  try {
    await new Promise((resolve, reject) => {
      upload.single('file')(req, res, (err) => { if (err) reject(err); else resolve(); });
    });
  } catch (uploadErr) {
    console.error('[customer import] multer error:', uploadErr.message);
    return res.status(400).json({ error: '檔案上傳失敗：' + uploadErr.message });
  }

  try {
    console.log('[customer import] file received:', req.file?.originalname, req.file?.size);
    if (!req.file) return res.status(400).json({ error: '請上傳 Excel 檔案' });

    const apiKey = getApiKey();
    if (!apiKey) return res.status(500).json({ error: '請先在系統設定中填入 Anthropic API Key' });

    let rows;
    try {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      let sheetName = wb.SheetNames[0];
      for (const name of wb.SheetNames) {
        if (/客戶|customer|聯絡/i.test(name)) { sheetName = name; break; }
      }
      rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    } catch (e) {
      return res.status(400).json({ error: '無法解析 Excel 檔案：' + e.message });
    }
    if (!rows.length) return res.status(400).json({ error: 'Excel 無資料' });

    const client = new Anthropic({ apiKey });
    const userMsg = `Excel 共 ${rows.length} 筆，欄位：${Object.keys(rows[0]).join('、')}\n\n${JSON.stringify(rows, null, 2)}\n\n請直接輸出 JSON 陣列。`;

    let customers;
    try {
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: CUSTOMER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      });
      const text = msg.content[0].text.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
      const match = text.match(/\[[\s\S]+\]/);
      customers = JSON.parse(match ? match[0] : text);
    } catch (e) {
      return res.status(500).json({ error: 'Claude 分析失敗：' + e.message });
    }

    const db = getDb();
    const existingEmails = new Set(
      db.prepare("SELECT email FROM customers WHERE email != ''").all().map(r => r.email)
    );
    db.close();

    const result = customers.map(c => {
      const errors = [];
      if (!c.name?.trim()) errors.push('缺少姓名');
      const isDup = c.email && existingEmails.has(c.email);
      return {
        ...c,
        _status: errors.length ? 'error' : isDup ? 'duplicate' : 'new',
        _errors: errors,
      };
    });

    res.json({
      total:           result.length,
      new_count:       result.filter(r => r._status === 'new').length,
      duplicate_count: result.filter(r => r._status === 'duplicate').length,
      error_count:     result.filter(r => r._status === 'error').length,
      customers: result,
    });
  } catch (e) {
    console.error('customer import preview error:', e);
    res.status(500).json({ error: '伺服器錯誤：' + e.message });
  }
});

// ── POST /import/confirm ──────────────────────────────────────
router.post('/import/confirm', adminOnly, (req, res) => {
  try {
    const { customers, skip_duplicates } = req.body;
    if (!Array.isArray(customers) || !customers.length) {
      return res.status(400).json({ error: '無客戶資料' });
    }

    const valid = customers.filter(c => c.name?.trim() && c._status !== 'error');
    if (!valid.length) return res.status(400).json({ error: '沒有可匯入的資料' });

    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO customers (name, org, phone, email, address, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0, skipped = 0;
    const doImport = db.transaction(() => {
      for (const c of valid) {
        if (c._status === 'duplicate' && skip_duplicates) { skipped++; continue; }
        insert.run(c.name.trim(), c.org||'', c.phone||'', c.email||'', c.address||'', c.notes||'');
        inserted++;
      }
    });
    doImport();
    db.close();

    res.json({ message: '匯入完成', inserted, skipped });
  } catch (e) {
    console.error('customer import confirm error:', e);
    res.status(500).json({ error: '伺服器錯誤：' + e.message });
  }
});

// ── GET /search?q=關鍵字 ─────────────────────────────────────
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
