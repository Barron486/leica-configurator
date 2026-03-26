const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');

// Railway 掛載磁碟預設在 /data，本機則放在專案根目錄
// 自動偵測 Railway 環境（RAILWAY_ENVIRONMENT 變數由平台注入）
const DB_PATH = process.env.DB_PATH ||
  (process.env.RAILWAY_ENVIRONMENT ? '/data/leica.db' : path.join(__dirname, '..', 'leica.db'));

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
      case_notes TEXT DEFAULT '',
      reviewer_role TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      submitted_at DATETIME,
      reviewed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      custom_item_name TEXT DEFAULT '',
      custom_catalog_number TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      unit_price_snapshot REAL DEFAULT 0,
      price_type TEXT DEFAULT 'retail'
    );

    CREATE TABLE IF NOT EXISTS boms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      instrument_category TEXT DEFAULT '',
      short_description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS catalog_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      instrument_category TEXT NOT NULL,
      subcategory TEXT DEFAULT '',
      short_description TEXT DEFAULT '',
      status TEXT DEFAULT 'coming_soon' CHECK(status IN ('available','coming_soon')),
      configurator_url TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 99,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bom_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bom_id INTEGER NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER DEFAULT 1,
      notes TEXT,
      required INTEGER DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT PRIMARY KEY,
      import_products INTEGER DEFAULT 0,
      manage_approval INTEGER DEFAULT 0,
      manage_bom INTEGER DEFAULT 0,
      manage_users INTEGER DEFAULT 0,
      manage_products INTEGER DEFAULT 0,
      manage_pricing INTEGER DEFAULT 0,
      manage_quotes INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      requires_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER DEFAULT 1,
      UNIQUE(product_id, requires_product_id)
    );

    CREATE TABLE IF NOT EXISTS api_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      description TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS instrument_categories (
      key        TEXT PRIMARY KEY,
      label_zh   TEXT NOT NULL,
      label_en   TEXT DEFAULT '',
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 99
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      org  TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // 5. users: 加入 quote_prefix 欄位
    try {
      const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
      if (!userCols.includes('quote_prefix')) {
        db.exec("ALTER TABLE users ADD COLUMN quote_prefix TEXT DEFAULT ''");
        console.log('Migration 5: added users.quote_prefix');
      }
    } catch(e) { console.error('Migration 5 error:', e.message); }

    // 6. boms: 加入 instrument_category + short_description 欄位
    try {
      const bomCols = db.prepare("PRAGMA table_info(boms)").all().map(c => c.name);
      if (!bomCols.includes('instrument_category')) {
        db.exec("ALTER TABLE boms ADD COLUMN instrument_category TEXT DEFAULT ''");
        console.log('Migration 6a: added boms.instrument_category');
      }
      if (!bomCols.includes('short_description')) {
        db.exec("ALTER TABLE boms ADD COLUMN short_description TEXT DEFAULT ''");
        console.log('Migration 6b: added boms.short_description');
      }
    } catch(e) { console.error('Migration 6 error:', e.message); }

    // 7. 初始化 catalog_items（若空則 seed）
    try {
      const cnt = db.prepare("SELECT COUNT(*) AS c FROM catalog_items").get();
      if (cnt.c === 0) {
        const ins = db.prepare(`INSERT INTO catalog_items (name, instrument_category, subcategory, status, configurator_url, sort_order) VALUES (?,?,?,?,?,?)`);
        const seed = db.transaction(() => {
          // Digital Pathology - WSI
          ins.run('Aperio GT 450','digital_pathology','掃描儀','coming_soon','',1);
          ins.run('Aperio GT 180','digital_pathology','掃描儀','coming_soon','',2);
          ins.run('Aperio CS5','digital_pathology','掃描儀','coming_soon','',3);
          ins.run('Aperio FL','digital_pathology','掃描儀','coming_soon','',4);
          // Digital Pathology - AI
          ins.run('Aperio HALO AP','digital_pathology','AI 分析平台','coming_soon','',5);
          ins.run('HALO AI','digital_pathology','AI 分析平台','coming_soon','',6);
          // Digital Pathology - Cyto
          ins.run('CytoVision','digital_pathology','細胞遺傳學','coming_soon','',7);
          ins.run('CytoInsight AI','digital_pathology','細胞遺傳學','coming_soon','',8);
          // Tissue Processor
          ins.run('HistoCore PELORIS 3','tissue_processor','','coming_soon','',1);
          ins.run('HistoCore PEGASUS','tissue_processor','','coming_soon','',2);
          ins.run('HistoCore PEARL','tissue_processor','','coming_soon','',3);
          // Embedding Center
          ins.run('Leica Arcadia C & S','embedding_center','','coming_soon','',1);
          // Microtome
          ins.run('HistoCore AUTOCUT','microtome','','coming_soon','',1);
          ins.run('HistoCore MULTICUT','microtome','','available','/index.html',2);
          ins.run('HistoCore BIOCUT','microtome','','coming_soon','',3);
          // Cryostat
          ins.run('Leica CM1950','cryostat','','coming_soon','',1);
          ins.run('Leica CM1860','cryostat','','coming_soon','',2);
          ins.run('Leica CM3050 S','cryostat','','coming_soon','',3);
          // Stainer
          ins.run('HistoCore SPECTRA ST','stainer','','coming_soon','',1);
          ins.run('Leica ST5010','stainer','','coming_soon','',2);
          ins.run('HistoCore CHROMAX','stainer','','coming_soon','',3);
          ins.run('Leica ST4020','stainer','','coming_soon','',4);
        });
        seed();
        console.log('Migration 7: seeded catalog_items');
      }
    } catch(e) { console.error('Migration 7 error:', e.message); }

    // 8. users: 允許 'super_admin' 和 'demo' 角色
    try {
      db.prepare("INSERT INTO users (username,password_hash,role,display_name) VALUES ('__satest','x','super_admin','x')").run();
      db.prepare("DELETE FROM users WHERE username='__satest'").run();
    } catch(e) {
      if (e.message.includes('CHECK constraint')) {
        db.exec(`
          CREATE TABLE users_v3 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','super_admin','demo','sales','customer','finance','management','gm','pm')),
            display_name TEXT NOT NULL,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            quote_prefix TEXT DEFAULT ''
          );
          INSERT INTO users_v3 SELECT id,username,password_hash,role,display_name,email,created_at,quote_prefix FROM users;
          DROP TABLE users;
          ALTER TABLE users_v3 RENAME TO users;
        `);
        console.log('Migration 8: added super_admin and demo roles');
      }
    }

    // 9. role_permissions: seed 預設權限
    try {
      const rpCnt = db.prepare("SELECT COUNT(*) AS c FROM role_permissions").get();
      if (rpCnt.c === 0) {
        const insRp = db.prepare(`INSERT OR IGNORE INTO role_permissions
          (role, import_products, manage_approval, manage_bom, manage_users, manage_products, manage_pricing, manage_quotes)
          VALUES (?,?,?,?,?,?,?,?)`);
        const seedRp = db.transaction(() => {
          insRp.run('admin',       1,1,1,1,1,1,1);
          insRp.run('super_admin', 1,1,1,1,1,1,1);
          insRp.run('sales',       0,0,0,0,0,0,1);
          insRp.run('customer',    0,0,0,0,0,0,0);
          insRp.run('finance',     0,0,0,0,0,0,1);
          insRp.run('management',  0,0,0,0,0,0,1);
          insRp.run('gm',          0,0,0,0,0,0,1);
          insRp.run('pm',          0,0,0,0,0,0,1);
          insRp.run('demo',        0,0,0,0,0,0,0);
        });
        seedRp();
        console.log('Migration 9: seeded role_permissions');
      }
    } catch(e) { console.error('Migration 9 error:', e.message); }

    // 10. quotes: 加入 case_notes 欄位
    try {
      const qCols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name);
      if (!qCols.includes('case_notes')) {
        db.exec("ALTER TABLE quotes ADD COLUMN case_notes TEXT DEFAULT ''");
        console.log('Migration 10: added quotes.case_notes');
      }
    } catch(e) { console.error('Migration 10 error:', e.message); }

    // 12. 修正 149MULTI0C4 的 is_base_unit — 讓該產品可在配置器中選取
    try {
      db.prepare("UPDATE products SET is_base_unit=0 WHERE catalog_number='149MULTI0C4' AND is_base_unit=1").run();
    } catch(e) { console.error('Migration 12 error:', e.message); }

    // 11. 建立 notifications 表
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT DEFAULT '',
        link TEXT DEFAULT '',
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('Migration 11: created notifications table');
    } catch(e) { console.error('Migration 11 error:', e.message); }

    // 12. 修正 149MULTI0C4 的 is_base_unit — 此 migration 已在 fix commit 中加入，保留但改為 idempotent
    // (此處原本有 migration 12，已移至 fix commit)

    // 13. boms: 加入 subcategory 欄位（供數位病理子分類使用）
    try {
      const bomCols3 = db.prepare("PRAGMA table_info(boms)").all().map(c => c.name);
      if (!bomCols3.includes('subcategory')) {
        db.exec("ALTER TABLE boms ADD COLUMN subcategory TEXT DEFAULT ''");
        console.log('Migration 13: added boms.subcategory');
      }
    } catch(e) { console.error('Migration 13 error:', e.message); }

    // 14. 將 catalog_items 全部轉換為 BOMs（唯讀 catalog 統一以 BOM 管理）
    try {
      const catItems = db.prepare(
        "SELECT * FROM catalog_items WHERE active=1 AND instrument_category != ''"
      ).all();
      const checkBom  = db.prepare("SELECT id FROM boms WHERE name=? AND instrument_category=?");
      const insertBom = db.prepare(
        "INSERT INTO boms (name, instrument_category, subcategory, short_description, active) VALUES (?,?,?,?,?)"
      );
      const doMigrate = db.transaction(() => {
        for (const item of catItems) {
          if (!checkBom.get(item.name, item.instrument_category)) {
            insertBom.run(
              item.name,
              item.instrument_category,
              item.subcategory || '',
              item.short_description || '',
              item.status === 'available' ? 1 : 0
            );
          }
        }
      });
      doMigrate();
      console.log('Migration 14: catalog_items → BOMs');
    } catch(e) { console.error('Migration 14 error:', e.message); }

    // 15. quote_items: make product_id nullable, add custom_item_name + custom_catalog_number
    try {
      const qiCols = db.prepare("PRAGMA table_info(quote_items)").all().map(c => c.name);
      if (!qiCols.includes('custom_item_name')) {
        db.exec(`
          CREATE TABLE quote_items_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id),
            custom_item_name TEXT DEFAULT '',
            custom_catalog_number TEXT DEFAULT '',
            quantity INTEGER DEFAULT 1,
            unit_price_snapshot REAL DEFAULT 0,
            price_type TEXT DEFAULT 'retail'
          );
          INSERT INTO quote_items_v2 (id, quote_id, product_id, quantity, unit_price_snapshot, price_type)
            SELECT id, quote_id, product_id, quantity, unit_price_snapshot, price_type FROM quote_items;
          DROP TABLE quote_items;
          ALTER TABLE quote_items_v2 RENAME TO quote_items;
        `);
        console.log('Migration 15: quote_items supports custom items');
      }
    } catch(e) { console.error('Migration 15 error:', e.message); }

    // 18. product_dependencies 表（舊 DB 補建）
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS product_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        requires_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER DEFAULT 1,
        UNIQUE(product_id, requires_product_id)
      )`);
      console.log('Migration 18: product_dependencies table ready');
    } catch(e) { console.error('Migration 18 error:', e.message); }

    // 17. bom_items: 加入 required 欄位（強制選配）
    try {
      const biCols = db.prepare("PRAGMA table_info(bom_items)").all().map(c => c.name);
      if (!biCols.includes('required')) {
        db.exec("ALTER TABLE bom_items ADD COLUMN required INTEGER DEFAULT 1");
        console.log('Migration 17: added bom_items.required');
      }
    } catch(e) { console.error('Migration 17 error:', e.message); }

    // 20. instrument_categories 表（舊 DB 補建 + seed 既有硬編碼分類）
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS instrument_categories (
        key        TEXT PRIMARY KEY,
        label_zh   TEXT NOT NULL,
        label_en   TEXT DEFAULT '',
        description TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 99
      )`);
      const insIC = db.prepare(`INSERT OR IGNORE INTO instrument_categories (key, label_zh, label_en, sort_order) VALUES (?,?,?,?)`);
      const seedIC = db.transaction(() => {
        insIC.run('digital_pathology', '數位病理', 'Digital Pathology', 1);
        insIC.run('tissue_processor',  '脫水機',   'Tissue Processor',  2);
        insIC.run('embedding_center',  '包埋機',   'Embedding Center',  3);
        insIC.run('microtome',         '切片機（石蠟）', 'Microtome',    4);
        insIC.run('cryostat',          '冷凍切片機', 'Cryostat',        5);
        insIC.run('stainer',           '染色機',   'Stainer',           6);
      });
      seedIC();
      console.log('Migration 20: instrument_categories table ready');
    } catch(e) { console.error('Migration 20 error:', e.message); }

    // 19. customers 表（舊 DB 補建）
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        org  TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        address TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      console.log('Migration 19: customers table ready');
    } catch(e) { console.error('Migration 19 error:', e.message); }

    // 16. api_settings: seed 初始 key（舊 DB 需補建表）
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS api_settings (
        key TEXT PRIMARY KEY,
        value TEXT DEFAULT '',
        description TEXT DEFAULT '',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by INTEGER REFERENCES users(id)
      )`);
      const insKey = db.prepare(`INSERT OR IGNORE INTO api_settings (key, value, description) VALUES (?,?,?)`);
      insKey.run('openai_api_key',    '', 'OpenAI API Key（用於 AI 產品匯入分析）');
      insKey.run('gemini_api_key',    '', 'Google Gemini API Key');
      insKey.run('anthropic_api_key', '', 'Anthropic Claude API Key');
      console.log('Migration 16: api_settings table ready');
    } catch(e) { console.error('Migration 16 error:', e.message); }

  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

module.exports = { getDb, initSchema, DB_PATH };
