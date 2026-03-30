const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { getDb } = require('../database/schema');
const { logAudit, getIp } = require('../utils/audit');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('\n❌ 缺少環境變數 JWT_SECRET，請建立 .env 檔案\n');
  process.exit(1);
}

// 記錄失敗次數（in-memory，重啟後重置；可日後改用 Redis）
const loginAttempts = new Map();

function getAttemptKey(req) {
  return req.ip + ':' + (req.body.username || '');
}

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }

  // 記錄此 IP + 帳號的失敗次數
  const key = getAttemptKey(req);
  const attempts = loginAttempts.get(key) || { count: 0, blockedUntil: 0 };

  if (Date.now() < attempts.blockedUntil) {
    const waitSec = Math.ceil((attempts.blockedUntil - Date.now()) / 1000);
    return res.status(429).json({ error: `帳號已暫時鎖定，請 ${waitSec} 秒後再試` });
  }

  const db   = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  db.close();

  const valid = user && bcrypt.compareSync(password, user.password_hash);

  if (!valid) {
    attempts.count += 1;
    logAudit({ username, action: 'login_failed', resource: 'auth', detail: { reason: '帳號或密碼錯誤' }, ip: getIp(req) });
    // 連續失敗 5 次 → 鎖定 15 分鐘
    if (attempts.count >= 5) {
      attempts.blockedUntil = Date.now() + 15 * 60 * 1000;
      attempts.count = 0;
      loginAttempts.set(key, attempts);
      logAudit({ username, action: 'login_blocked', resource: 'auth', detail: { reason: '失敗次數過多，鎖定15分鐘' }, ip: getIp(req) });
      return res.status(429).json({ error: '失敗次數過多，帳號已鎖定 15 分鐘' });
    }
    loginAttempts.set(key, attempts);
    return res.status(401).json({ error: `帳號或密碼錯誤（剩餘 ${5 - attempts.count} 次）` });
  }

  // 登入成功 → 清除失敗記錄
  loginAttempts.delete(key);
  logAudit({ userId: user.id, username: user.username, role: user.role, action: 'login', resource: 'auth', ip: getIp(req) });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
  });
});

module.exports = router;
module.exports.JWT_SECRET = JWT_SECRET;
