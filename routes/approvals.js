'use strict';

const express  = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

const ADMIN_ROLES = ['admin', 'super_admin'];

// 所有登入用戶都能取得審批鏈；有 manage_approval 權限才可修改
function canManage(req, res, next) {
  if (ADMIN_ROLES.includes(req.user?.role)) return next();
  const db = getDb();
  const rp = db.prepare('SELECT manage_approval FROM role_permissions WHERE role=?').get(req.user?.role);
  db.close();
  if (!rp?.manage_approval) return res.status(403).json({ error: '無審批鏈管理權限' });
  next();
}

// GET /api/approvals/chain — 取得審批鏈（含用戶詳情）
router.get('/chain', (req, res) => {
  const db = getDb();
  const chain = db.prepare(`
    SELECT ac.id, ac.step_order, ac.created_at,
      u.id AS user_id, u.display_name, u.username, u.role, u.email
    FROM approval_chain ac
    JOIN users u ON u.id = ac.user_id
    ORDER BY ac.step_order, ac.id
  `).all();
  db.close();
  res.json(chain);
});

// GET /api/approvals/eligible — 可加入審批鏈的用戶（排除已在鏈中的）
router.get('/eligible', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.id, u.display_name, u.username, u.role
    FROM users u
    WHERE u.role IN ('admin','super_admin','finance','management','gm','pm')
      AND u.id NOT IN (SELECT user_id FROM approval_chain)
    ORDER BY u.role, u.display_name
  `).all();
  db.close();
  res.json(users);
});

// POST /api/approvals/chain — 加入審批鏈
router.post('/chain', canManage, (req, res) => {
  const { user_id, step_order } = req.body;
  if (!user_id) return res.status(400).json({ error: '請選擇用戶' });
  const db = getDb();
  try {
    // 確認目標用戶存在
    const target = db.prepare('SELECT id FROM users WHERE id=?').get(user_id);
    if (!target) { db.close(); return res.status(400).json({ error: '找不到指定用戶' }); }
    // created_by 若當前用戶不存在則設為 NULL（避免 FK 失敗）
    const creator = db.prepare('SELECT id FROM users WHERE id=?').get(req.user.id);
    const result = db.prepare(
      'INSERT INTO approval_chain (user_id, step_order, created_by) VALUES (?,?,?)'
    ).run(user_id, step_order || 99, creator ? req.user.id : null);
    db.close();
    res.status(201).json({ id: result.lastInsertRowid });
  } catch(e) {
    db.close();
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '此用戶已在審批鏈中' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/approvals/chain/:id — 更新順序
router.put('/chain/:id', canManage, (req, res) => {
  const { step_order } = req.body;
  const db = getDb();
  db.prepare('UPDATE approval_chain SET step_order=? WHERE id=?').run(step_order || 99, req.params.id);
  db.close();
  res.json({ message: '已更新' });
});

// DELETE /api/approvals/chain/:id — 移除出審批鏈
router.delete('/chain/:id', canManage, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM approval_chain WHERE id=?').run(req.params.id);
  db.close();
  res.json({ message: '已移除' });
});

module.exports = router;
