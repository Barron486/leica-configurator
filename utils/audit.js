'use strict';

const { getDb } = require('../database/schema');

/**
 * 寫入稽核日誌
 * @param {object} opts
 * @param {number|null} opts.userId
 * @param {string}      opts.username
 * @param {string}      opts.role
 * @param {string}      opts.action     - e.g. 'login', 'create_quote', 'approve_quote'
 * @param {string}      opts.resource   - e.g. 'quotes', 'users', 'products'
 * @param {string|number|null} opts.resourceId
 * @param {object|string|null} opts.detail  - 額外資訊（自動 JSON.stringify）
 * @param {string}      opts.ip
 */
function logAudit({ userId = null, username = '', role = '', action, resource = '', resourceId = null, detail = null, ip = '' }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_logs (user_id, username, role, action, resource, resource_id, detail, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      username,
      role,
      action,
      resource,
      resourceId != null ? String(resourceId) : null,
      detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
      ip
    );
    db.close();
  } catch (e) {
    // 日誌失敗不影響主流程
    console.error('[audit] write error:', e.message);
  }
}

/**
 * 從 req 物件快速取得 IP
 */
function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

module.exports = { logAudit, getIp };
