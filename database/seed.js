const bcrypt = require('bcryptjs');
const { getDb, initSchema } = require('./schema');

function seed() {
  initSchema();
  const db = getDb();

  // ── 預設使用者 ───────────────────────────────────────────────
  const users = [
    { username: 'admin',    password: 'admin123',    role: 'admin',      display_name: '管理員',   email: 'admin@genmall.com.tw' },
    { username: 'sales',    password: 'sales123',    role: 'sales',      display_name: '業務代表', email: 'sales@genmall.com.tw' },
    { username: 'customer', password: 'demo123',     role: 'customer',   display_name: '示範客戶', email: 'demo@hospital.com' },
    { username: 'finance',  password: 'finance123',  role: 'finance',    display_name: '財務部',   email: 'finance@genmall.com.tw' },
    { username: 'manager',  password: 'manager123',  role: 'management', display_name: '管理部',   email: 'manager@genmall.com.tw' },
    { username: 'gm',       password: 'gm888888',    role: 'gm',         display_name: '總經理',   email: 'gm@genmall.com.tw' },
  ];

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, role, display_name, email)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const u of users) {
    const hash = bcrypt.hashSync(u.password, 10);
    insertUser.run(u.username, hash, u.role, u.display_name, u.email);
  }

  // ── 產品資料（來源：手冊 14051880128Q v2.3Q）────────────────
  // category: base | orientation | clamping | holder | blade_base | blade_holder | blade | cooling | lighting | accessory
  const products = [
    // ── 基礎配置 149MULTI0C4 ────────────────────────────
    {
      catalog_number: '149MULTI0C4',
      name_zh: 'HistoCore MULTICUT 配置 C4',
      name_en: 'HistoCore MULTICUT Configuration C4',
      category: 'base',
      is_base_unit: 1,
      is_included_in_base: 0,
      description: '含：基本儀器、快速夾緊系統、良好方向性檢體夾具固定裝置、通用匣盒夾具、刀架底座、刀架 DL、國際使用說明套裝',
      notes: '標準配置，適合大多數常規組織學實驗室',
      sort_order: 1,
    },

    // ── 主機 ──────────────────────────────────────────────
    {
      catalog_number: '14 0518 56372',
      name_zh: 'HistoCore MULTICUT 基本儀器',
      name_en: 'HistoCore MULTICUT Basic Instrument',
      category: 'base',
      is_base_unit: 0,
      is_included_in_base: 1,
      description: '半電動旋轉切片機主機。含分離式控制面板、電動粗推進輪、防靜電廢棄物托盤。不含定向裝置、夾具、刀架。',
      sort_order: 2,
    },

    // ── 檢體夾具固定裝置 ────────────────────────────────────
    {
      catalog_number: '14 0502 37717',
      name_zh: '良好方向性檢體夾具固定裝置',
      name_en: 'Fine Orientation Specimen Clamp Holder',
      category: 'orientation',
      is_included_in_base: 1,
      description: '提供精確三維方向調整（水平±8°、垂直±8°），適合需要精準定向的組織切片。已含於 149MULTI0C4 配置中。',
      sort_order: 10,
    },
    {
      catalog_number: '14 0502 38949',
      name_zh: '方向性檢體夾具固定裝置',
      name_en: 'Orientation Specimen Clamp Holder',
      category: 'orientation',
      description: '提供基本方向性定向功能，適合一般常規應用。',
      sort_order: 11,
    },
    {
      catalog_number: '14 0502 38160',
      name_zh: '剛性檢體夾具固定裝置',
      name_en: 'Rigid Specimen Clamp Holder',
      category: 'orientation',
      description: '無定向功能，剛性固定。需搭配超級匣盒夾具使用。',
      sort_order: 12,
    },

    // ── 快速夾緊系統 ─────────────────────────────────────────
    {
      catalog_number: '14 0502 37718',
      name_zh: '快速夾緊系統',
      name_en: 'Quick Clamping System',
      category: 'clamping',
      is_included_in_base: 1,
      description: '搭配良好方向性或方向性夾具固定裝置使用，加速檢體裝卸效率。已含於 149MULTI0C4 配置中。',
      sort_order: 20,
    },

    // ── 檢體夾具 ────────────────────────────────────────────
    {
      catalog_number: '14 0502 37999',
      name_zh: '通用匣盒夾具 (UCC)',
      name_en: 'Universal Cassette Clamp',
      category: 'holder',
      is_included_in_base: 1,
      description: '適用於標準匣盒（39.8×28mm 至 40.9×28mm），最常用的檢體夾具。已含於 149MULTI0C4 配置中。',
      sort_order: 30,
    },
    {
      catalog_number: '14 0502 38967',
      name_zh: '超級匣盒夾具',
      name_en: 'Super Cassette Clamp',
      category: 'holder',
      description: '適用於較大尺寸匣盒（最大 68×48×15mm），需搭配剛性夾具固定裝置使用。',
      sort_order: 31,
    },
    {
      catalog_number: 'STD-5055',
      name_zh: '標準檢體夾具 50×55mm',
      name_en: 'Standard Specimen Clamp 50x55mm',
      category: 'holder',
      description: '直接夾緊矩形組織塊，大尺寸（50×55mm）。',
      notes: '確切料號請向 Leica 業務確認',
      sort_order: 32,
    },
    {
      catalog_number: 'STD-4040',
      name_zh: '標準檢體夾具 40×40mm',
      name_en: 'Standard Specimen Clamp 40x40mm',
      category: 'holder',
      description: '直接夾緊矩形組織塊，標準尺寸（40×40mm）。',
      notes: '確切料號請向 Leica 業務確認',
      sort_order: 33,
    },

    // ── 刀架底座 ────────────────────────────────────────────
    {
      catalog_number: '14 0502 37962',
      name_zh: '刀架底座',
      name_en: 'Knife Holder Base',
      category: 'blade_base',
      is_included_in_base: 1,
      description: '適用於刀架 DH/DL/N/E。已含於 149MULTI0C4 配置中。',
      sort_order: 40,
    },
    {
      catalog_number: '14 0502 37993',
      name_zh: '刀片架底座',
      name_en: 'Disposable Blade Holder Base',
      category: 'blade_base',
      description: '適用於 2合1式刀片架 E，使用一次性拋棄式刀片。',
      sort_order: 41,
    },

    // ── 刀架 / 刀片架 ────────────────────────────────────────
    {
      catalog_number: '14 0517 60830',
      name_zh: '刀架 DL',
      name_en: 'Knife Holder DL',
      category: 'blade_holder',
      is_included_in_base: 1,
      description: '低剖面刀架，適用於較軟組織或要求薄切片的應用。已含於 149MULTI0C4 配置中。',
      sort_order: 50,
    },
    {
      catalog_number: 'DH-CODE',
      name_zh: '刀架 DH',
      name_en: 'Knife Holder DH',
      category: 'blade_holder',
      description: '高剖面刀架，適用於較硬或較厚組織切片。',
      notes: '確切料號請向 Leica 業務確認',
      sort_order: 51,
    },
    {
      catalog_number: '14 0502 38961',
      name_zh: '刀架 E，具水槽，窄型',
      name_en: 'Knife Holder E with Trough, Narrow',
      category: 'blade_holder',
      description: '具有水槽的窄型刀架，適用於漂浮切片技術。',
      sort_order: 52,
    },
    {
      catalog_number: 'N-CODE',
      name_zh: '刀架 N',
      name_en: 'Knife Holder N',
      category: 'blade_holder',
      description: '標準型刀架 N，適用於常規鋼刀應用。',
      notes: '確切料號請向 Leica 業務確認',
      sort_order: 53,
    },
    {
      catalog_number: 'E2IN1-CODE',
      name_zh: '2合1式刀片架 E',
      name_en: '2-in-1 Blade Holder E',
      category: 'blade_holder',
      description: '可使用高剖面與低剖面拋棄式刀片，具橫向移動功能，含刀片頂出器。',
      notes: '確切料號請向 Leica 業務確認',
      sort_order: 54,
    },

    // ── 刀片（耗材）────────────────────────────────────────
    {
      catalog_number: '14 0358 38382',
      name_zh: 'Leica 819 拋棄式刀片 — 窄刀片（10包×50片）',
      name_en: 'Leica 819 Disposable Blades Narrow (10 packs × 50)',
      category: 'blade',
      description: '窄刀片：80mm×8mm×0.254mm，適用於 2合1式刀片架 E。10包裝。',
      sort_order: 60,
    },
    {
      catalog_number: '14 0358 38925',
      name_zh: 'Leica 819 拋棄式刀片 — 窄刀片（1包×50片）',
      name_en: 'Leica 819 Disposable Blades Narrow (1 pack × 50)',
      category: 'blade',
      description: '窄刀片：80mm×8mm×0.254mm，單包裝。',
      sort_order: 61,
    },
    {
      catalog_number: '14 0358 38383',
      name_zh: 'Leica 818 拋棄式刀片 — 寬刀片（10包×50片）',
      name_en: 'Leica 818 Disposable Blades Wide (10 packs × 50)',
      category: 'blade',
      description: '寬刀片：80mm×14mm×0.317mm，適用於 2合1式刀片架 E。10包裝。',
      sort_order: 62,
    },
    {
      catalog_number: '14 0358 38926',
      name_zh: 'Leica 818 拋棄式刀片 — 寬刀片（1包×50片）',
      name_en: 'Leica 818 Disposable Blades Wide (1 pack × 50)',
      category: 'blade',
      description: '寬刀片：80mm×14mm×0.317mm，單包裝。',
      sort_order: 63,
    },
    {
      catalog_number: '14 0216 07132',
      name_zh: '鋼刀 16cm d型',
      name_en: 'Steel Knife 16cm Type D',
      category: 'blade',
      description: '可重複使用鋼刀，16cm d型，含刀具盒。',
      sort_order: 64,
    },
    {
      catalog_number: '14 0216 07100',
      name_zh: '鋼刀 16cm c型',
      name_en: 'Steel Knife 16cm Type C',
      category: 'blade',
      description: '可重複使用鋼刀，16cm c型。',
      sort_order: 65,
    },

    // ── 冷卻系統 ─────────────────────────────────────────────
    {
      catalog_number: '14 0502 46573',
      name_zh: 'Leica RM CoolClamp 冷卻夾具',
      name_en: 'Leica RM CoolClamp',
      category: 'cooling',
      description: '電動冷卻通用匣盒夾具，環境溫度以下降低 20K，預冷時間 30 分鐘。適合 IHC 應用，提升切片均勻性。',
      sort_order: 70,
    },

    // ── 照明與觀察 ────────────────────────────────────────────
    {
      catalog_number: '14 0502 38719',
      name_zh: '背光裝置',
      name_en: 'Backlight Device',
      category: 'lighting',
      description: '適用於 HistoCore MULTICUT，需搭配外部電源供應單元（14 0500 31244）使用。',
      sort_order: 80,
    },
    {
      catalog_number: '14 0500 31244',
      name_zh: '外部電源供應單元（背光裝置用）',
      name_en: 'External Power Supply Unit for Backlight',
      category: 'lighting',
      description: '背光裝置專用電源，含 UK/EU/US/澳洲轉接器。',
      sort_order: 81,
    },
    {
      catalog_number: '14 0502 42790',
      name_zh: '放大鏡（2倍）',
      name_en: 'Magnifier 2x',
      category: 'lighting',
      description: '2倍放大鏡，安裝於通用顯微鏡載物台，含 LED 照明轉接器。',
      sort_order: 82,
    },
    {
      catalog_number: '14 0502 40580',
      name_zh: '通用顯微鏡載物台',
      name_en: 'Universal Microscope Stage',
      category: 'lighting',
      description: '通用組合件，用於安裝放大鏡或顯微鏡。',
      sort_order: 83,
    },
    {
      catalog_number: '14 6000 04826',
      name_zh: 'LED 1000 高功率聚光燈（2臂）',
      name_en: 'LED 1000 High-Power Lamp (2-arm)',
      category: 'lighting',
      description: '高功率 LED 聚光燈 2臂款，需搭配 LED 1000 控制單元（14 6000 04825）。',
      sort_order: 84,
    },
    {
      catalog_number: '14 6000 04825',
      name_zh: 'LED 1000 控制單元',
      name_en: 'LED 1000 Control Unit',
      category: 'lighting',
      description: 'LED 1000 控制單元，需搭配 2臂式 LED 1000 高功率聚光燈（14 6000 04826）。',
      sort_order: 85,
    },

    // ── 其他配件 ─────────────────────────────────────────────
    {
      catalog_number: '14 0517 56261',
      name_zh: '頂部托盤',
      name_en: 'Top Tray',
      category: 'accessory',
      description: '用於放置剖切工具，防止物品掉落。',
      sort_order: 90,
    },
    {
      catalog_number: '14 0517 56237',
      name_zh: '防靜電廢棄物托盤（含防靜電）',
      name_en: 'Antistatic Waste Tray',
      category: 'accessory',
      description: '防靜電材料，容積 1400ml，便於清潔。',
      sort_order: 91,
    },
    {
      catalog_number: '14 0183 40426',
      name_zh: '具磁鐵的刷子',
      name_en: 'Magnetic Brush',
      category: 'accessory',
      description: '用於 2合1式刀片架 E 的刀片拆卸，含磁鐵。',
      sort_order: 92,
    },
    {
      catalog_number: '14 0340 29011',
      name_zh: '防切割安全手套 M 號',
      name_en: 'Cut Protection Gloves Size M',
      category: 'accessory',
      description: '250±20mm，黃色，M 號。',
      sort_order: 93,
    },
    {
      catalog_number: '14 0340 40859',
      name_zh: '防切割安全手套 S 號',
      name_en: 'Cut Protection Gloves Size S',
      category: 'accessory',
      description: '250±20mm，S 號。',
      sort_order: 94,
    },
  ];

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products
      (catalog_number, name_zh, name_en, category, is_base_unit, is_included_in_base, description, notes, sort_order)
    VALUES
      (@catalog_number, @name_zh, @name_en, @category, @is_base_unit, @is_included_in_base, @description, @notes, @sort_order)
  `);

  const insertPricing = db.prepare(`
    INSERT OR IGNORE INTO pricing (product_id, cost_price, min_sell_price, suggested_price, retail_price, currency)
    SELECT id, 0, 0, 0, 0, 'TWD' FROM products WHERE catalog_number = ?
  `);

  for (const p of products) {
    insertProduct.run({
      is_base_unit: 0,
      is_included_in_base: 0,
      name_en: null,
      notes: null,
      ...p,
    });
    insertPricing.run(p.catalog_number);
  }

  db.close();
  console.log(`Seeded ${products.length} products and default users.`);
  console.log('\n預設帳號：');
  console.log('  admin / admin123   → 管理員（可看成本、全部價格）');
  console.log('  sales / sales123   → 業務（可看最低售價、建議報價）');
  console.log('  customer / demo123 → 客戶（只看建議零售價）');
}

seed();
