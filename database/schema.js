const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

// Railway 掛載磁碟預設在 /data，本機則放在專案根目錄
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'leica.db');

// 確保目錄存在
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function getDb() {
  return new Database(DB_PATH);
}

function initSchema() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','sales','customer','finance','management','gm','pm')),
      display_name TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_number TEXT UNIQUE NOT NULL,
      name_zh TEXT NOT NULL,
      name_en TEXT,
      category TEXT NOT NULL,
      is_base_unit INTEGER DEFAULT 0,
      is_included_in_base INTEGER DEFAULT 0,
      description TEXT,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS pricing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      cost_price REAL DEFAULT 0,
      min_sell_price REAL DEFAULT 0,
      suggested_price REAL DEFAULT 0,
      retail_price REAL DEFAULT 0,
      currency TEXT DEFAULT 'TWD',
      notes TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL,
      customer_org TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      sales_user_id INTEGER REFERENCES users(id),
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','pending_gm','pending_pm')),
      admin_notes TEXT,
      reviewer_role TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      submitted_at DATETIME,
      reviewed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER DEFAULT 1,
      unit_price_snapshot REAL DEFAULT 0,
      price_type TEXT DEFAULT 'retail'
    );

    CREATE TABLE IF NOT EXISTS boms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      UNIQUE(bom_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS approval_chain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL DEFAULT 99,
      created_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_brand_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
      UNIQUE(user_id, brand_id)
    );

    CREATE TABLE IF NOT EXISTS user_price_permissions (
      user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      can_see_cost INTEGER DEFAULT 0,
      can_see_min_price INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quote_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      step_label TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      actor_name TEXT,
      action TEXT NOT NULL CHECK(action IN ('pending','approved','rejected','skipped')),
      notes TEXT,
      acted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ── 遷移：舊 DB 升級 ──────────────────────────────────────
  _migrate(db);

  db.close();
  console.log('Schema initialized.');
}

function _migrate(db) {
  // 暫時關閉 FK 檢查，避免 DROP TABLE 時失敗
  db.exec('PRAGMA foreign_keys = OFF');

  try {
    // 1. users: 允許 'pm' 角色
    try {
      db.prepare("INSERT INTO users (username,password_hash,role,display_name) VALUES ('__pmtest','x','pm','x')").run();
      db.prepare("DELETE FROM users WHERE username='__pmtest'").run();
    } catch(e) {
      if (e.message.includes('CHECK constraint')) {
        db.exec(`
          CREATE TABLE users_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','sales','customer','finance','management','gm','pm')),
            display_name TEXT NOT NULL,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          INSERT INTO users_v2 SELECT * FROM users;
          DROP TABLE users;
          ALTER TABLE users_v2 RENAME TO users;
        `);
      }
    }

    // 2. quotes: 允許 'pending_pm' 狀態
    try {
      db.prepare("INSERT INTO quotes (quote_number,customer_name,status) VALUES ('__test','__test','pending_pm')").run();
      db.prepare("DELETE FROM quotes WHERE quote_number='__test'").run();
    } catch(e) {
      if (e.message.includes('CHECK constraint')) {
        db.exec(`
          CREATE TABLE quotes_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_number TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            customer_org TEXT,
            customer_email TEXT,
            customer_phone TEXT,
            sales_user_id INTEGER REFERENCES users(id),
            status TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','pending_gm','pending_pm')),
            admin_notes TEXT,
            reviewer_role TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            submitted_at DATETIME,
            reviewed_at DATETIME
          );
          INSERT INTO quotes_v2 SELECT * FROM quotes;
          DROP TABLE quotes;
          ALTER TABLE quotes_v2 RENAME TO quotes;
        `);
      }
    }

    // 3. products: 加入 pm_user_id 欄位
    const cols = db.prepare("PRAGMA table_info(products)").all().map(c => c.name);
    if (!cols.includes('pm_user_id')) {
      db.exec('ALTER TABLE products ADD COLUMN pm_user_id INTEGER REFERENCES users(id)');
    }

    // 4. products: 加入 brand_id 欄位
    const cols2 = db.prepare("PRAGMA table_info(products)").all().map(c => c.name);
    if (!cols2.includes('brand_id')) {
      db.exec('ALTER TABLE products ADD COLUMN brand_id INTEGER REFERENCES brands(id)');
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

module.exports = { getDb, initSchema };
