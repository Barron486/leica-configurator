'use strict';

const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../database/schema');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
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

// ── 用 Claude 識別欄位 mapping（只傳欄位名 + 前 5 筆）──────
// 回傳: { "Excel欄位名": "db_field", ... }  db_field ∈ {name,org,phone,email,address,notes}
async function detectColumnMapping(columns, sampleRows, apiKey) {
  const client = new Anthropic({ apiKey });
  const prompt = `你是資料欄位分析師。分析 Excel 欄位名稱，對應到以下 6 個資料庫欄位之一：
name（聯絡人姓名）、org（單位/醫院）、phone（電話）、email（電子郵件）、address（地址）、notes（備註）

Excel 欄位：${columns.join('、')}
前 3 筆範例：
${JSON.stringify(sampleRows.slice(0, 3), null, 2)}

只輸出 JSON 物件，key 為 Excel 欄位名，value 為對應的 db 欄位名。無法對應的欄位不要包含。
範例：{"姓名":"name","醫院":"org","聯絡電話":"phone"}`;

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = msg.content[0].text.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
  const match = text.match(/\{[\s\S]+\}/);
  return JSON.parse(match ? match[0] : text);
}

// ── Fallback：規則對應（AI 失敗時使用）────────────────────
const FALLBACK_PATTERNS = {
  name:    /^(聯絡人?|姓名|name|contact|客戶名稱?)$/i,
  org:     /^(單位|醫院|機構|公司|組織|org|organization|hospital|institution|department)$/i,
  phone:   /^(電話|手機|聯絡電話|phone|mobile|tel|telephone)$/i,
  email:   /^(email|e-mail|電子郵件|信箱|mail)$/i,
  address: /^(地址|住址|address|addr)$/i,
  notes:   /^(備註|注意|notes?|remark|comment|說明)$/i,
};
function buildFallbackMapping(columns) {
  const m = {};
  for (const col of columns) {
    for (const [field, rx] of Object.entries(FALLBACK_PATTERNS)) {
      if (rx.test(String(col).trim()) && !Object.values(m).includes(field)) {
        m[col] = field; break;
      }
    }
  }
  return m;
}

// ── 套用 mapping 到每一筆資料 ─────────────────────────────
function applyMapping(rows, mapping) {
  return rows.map(row => {
    const result = {};
    for (const [col, val] of Object.entries(row)) {
      const field = mapping[col];
      if (field && !result[field]) result[field] = String(val ?? '').trim();
    }
    return result;
  });
}

// ── POST /import/preview ──────────────────────────────────────
router.post('/import/preview', adminOnly, async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      upload.single('file')(req, res, (err) => { if (err) reject(err); else resolve(); });
    });
  } catch (uploadErr) {
    return res.status(400).json({ error: '檔案上傳失敗：' + uploadErr.message });
  }

  try {
    if (!req.file) return res.status(400).json({ error: '請上傳 Excel 檔案' });

    // 解析 Excel
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

    const columns = Object.keys(rows[0]);

    // 用 Claude 識別欄位（只傳欄位名 + 前 3 筆，payload 極小）
    let customers;
    const apiKey = getApiKey();
    if (apiKey) {
      try {
        const mapping = await detectColumnMapping(columns, rows, apiKey);
        customers = applyMapping(rows, mapping);
      } catch (e) {
        console.error('[customer import] AI mapping failed, fallback:', e.message);
        customers = applyMapping(rows, buildFallbackMapping(columns));
      }
    } else {
      customers = applyMapping(rows, buildFallbackMapping(columns));
    }

    // 查詢已存在的 email
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
    console.error('[customer import]', e.message);
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
    console.error('[customer import confirm]', e.message);
    res.status(500).json({ error: '伺服器錯誤：' + e.message });
  }
});

// ── GET /search?q=關鍵字 ─────────────────────────────────────
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET / ──────────────────────────────────────────────────────
router.get('/', adminOnly, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, name, org, phone, email, address, notes, created_at, updated_at
      FROM customers ORDER BY org, name
    `).all();
    db.close();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST / ────────────────────────────────────────────────────
router.post('/', adminOnly, (req, res) => {
  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /:id ──────────────────────────────────────────────────
router.put('/:id', adminOnly, (req, res) => {
  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────
router.delete('/:id', adminOnly, (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id);
    db.close();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
