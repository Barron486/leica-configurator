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
      role TEXT NOT NULL CHECK(role IN ('admin','sales','customer','finance','management','gm')),
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
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','pending_gm')),
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
  `);

  db.close();
  console.log('Schema initialized.');
}

module.exports = { getDb, initSchema };
