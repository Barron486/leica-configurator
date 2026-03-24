'use strict';
const express = require('express');
const { getDb } = require('../database/schema');
const router = express.Router();

// GET /api/notifications — 取得當前用戶的通知（最近 50 筆）
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND read=0').get(req.user.id).c;
  db.close();
  res.json({ notifications: rows, unread });
});

// PUT /api/notifications/read-all — 全部已讀（要放在 /:id/read 之前，避免路由衝突）
router.put('/read-all', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.user.id);
  db.close();
  res.json({ message: 'ok' });
});

// PUT /api/notifications/:id/read — 標為已讀
router.put('/:id/read', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  db.close();
  res.json({ message: 'ok' });
});

module.exports = router;
