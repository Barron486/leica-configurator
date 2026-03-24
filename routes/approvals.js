'use strict';

const express  = require('express');
const { getDb } = require('../database/schema');

const router = express.Router();

// 所有登入用戶都能取得審批鏈；sales + admin 可修改
function canManage(req, res, next) {
  if (!['admin', 'sales'].includes(req.user?.role)) {
    return res.status(403).json({ error: '無權限管理審批鏈' });
  }
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
    WHERE u.role IN ('admin','finance','management','gm','pm')
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
    const result = db.prepare(
      'INSERT INTO approval_chain (user_id, step_order, created_by) VALUES (?,?,?)'
    ).run(user_id, step_order || 99, req.user.id);
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
