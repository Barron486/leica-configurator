'use strict';

const express  = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

function superAdminOnly(req, res, next) {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ error: '需要超級管理員權限' });
  next();
}

// ── GET /api/admin/audit  ─────────────────────────────────────
// 查詢稽核日誌，支援過濾與 CSV 匯出
router.get('/', superAdminOnly, (req, res) => {
  const { action, resource, username, from, to, limit: lim, offset: off, format } = req.query;

  const conditions = [];
  const params     = [];

  if (action)   { conditions.push("action LIKE ?");    params.push(`%${action}%`); }
  if (resource) { conditions.push("resource = ?");     params.push(resource); }
  if (username) { conditions.push("username LIKE ?");  params.push(`%${username}%`); }
  if (from)     { conditions.push("created_at >= ?");  params.push(from); }
  if (to)       { conditions.push("created_at <= ?");  params.push(to + ' 23:59:59'); }

  const where  = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const limitN  = Math.min(parseInt(lim) || 200, 1000);
  const offsetN = parseInt(off) || 0;

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, created_at, user_id, username, role, action, resource, resource_id, detail, ip
    FROM audit_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limitN, offsetN);

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`).get(...params).cnt;
  db.close();

  // CSV 匯出
  if (format === 'csv') {
    const csvHeader = '時間,用戶,角色,動作,資源,資源ID,詳情,IP\n';
    const csvRows = rows.map(r => [
      r.created_at,
      r.username,
      r.role,
      r.action,
      r.resource,
      r.resource_id ?? '',
      r.detail ? r.detail.replace(/"/g, '""') : '',
      r.ip ?? '',
    ].map(v => `"${v}"`).join(',')).join('\n');

    const filename = `audit_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM for Excel UTF-8
    return res.send('\uFEFF' + csvHeader + csvRows);
  }

  res.json({ total, rows });
});

// ── GET /api/admin/audit/actions  ─────────────────────────────
// 取得所有出現過的 action 清單（供前端 filter 下拉）
router.get('/actions', superAdminOnly, (req, res) => {
  const db = getDb();
  const actions = db.prepare(`SELECT DISTINCT action FROM audit_logs ORDER BY action`).all().map(r => r.action);
  db.close();
  res.json(actions);
});

module.exports = router;
