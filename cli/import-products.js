#!/usr/bin/env node
'use strict';

/**
 * Leica 產品資料匯入 CLI
 * 用法：node cli/import-products.js <excel檔案路徑> [--dry-run] [--pricing]
 *
 * --dry-run   僅預覽，不寫入資料庫
 * --pricing   同時匯入定價欄位（成本、最低售價、建議報價、零售價）
 */

const path = require('path');
const fs   = require('fs');
const XLSX = require('xlsx');
const Anthropic = require('@anthropic-ai/sdk');
const readline  = require('readline');

// ── 引用資料庫 ──────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '..', 'leica.db');
const { getDb } = require('../database/schema');

// ── 常數 ────────────────────────────────────────────────────
const VALID_CATEGORIES = [
  'base', 'orientation', 'clamping', 'holder',
  'blade_base', 'blade_holder', 'blade', 'cooling', 'lighting', 'accessory',
];
const CATEGORY_LABELS = {
  base:         '基礎配置',
  orientation:  '檢體夾具固定裝置',
  clamping:     '快速夾緊系統',
  holder:       '檢體夾具',
  blade_base:   '刀架底座',
  blade_holder: '刀架 / 刀片架',
  blade:        '刀片（耗材）',
  cooling:      '冷卻系統',
  lighting:     '照明與觀察裝置',
  accessory:    '其他配件',
};

const SYSTEM_PROMPT = `你是一個 Leica 醫療設備產品資料分析師。
你的任務是分析使用者上傳的 Excel/CSV 產品資料，並將其對應到系統資料庫的欄位格式。

資料庫產品欄位：
- catalog_number (料號, TEXT, 必填，唯一)
- name_zh (中文名稱, TEXT, 必填)
- name_en (英文名稱, TEXT, 選填)
- category (類別, TEXT, 必填，只能是以下值之一):
  ${VALID_CATEGORIES.map(c => `"${c}" = ${CATEGORY_LABELS[c]}`).join('\n  ')}
- description (產品說明, TEXT, 選填)
- notes (注意事項, TEXT, 選填)
- sort_order (排序號, INTEGER, 選填, 預設0)
- is_base_unit (是否為基礎主機, 0或1, 預設0)
- is_included_in_base (是否包含於基礎配置, 0或1, 預設0)

定價欄位（若有）：
- cost_price (成本價, REAL)
- min_sell_price (最低售價, REAL)
- suggested_price (建議報價, REAL)
- retail_price (建議零售價, REAL)
- currency (幣別, 預設 "TWD")

回傳規則：
1. 輸出純 JSON 陣列，不要任何 markdown 或說明文字
2. 每筆資料必須包含 catalog_number、name_zh、category
3. category 只能用英文 key（如 "blade"），不能用中文
4. 若某欄位無法判斷，則省略該欄位（不要填入 null）
5. 若 Excel 有價格欄位，請對應到定價欄位；沒有則不輸出定價欄位
6. 料號格式通常為 14 開頭的數字（如 14051880128）或英數組合
7. 若遇到「基礎配置」、「主機」等字樣，將 is_base_unit 設為 1
8. 若遇到「含於基礎」、「標準配件」等字樣，將 is_included_in_base 設為 1

範例輸出：
[
  {
    "catalog_number": "14051880128",
    "name_zh": "HistoCore MULTICUT 主機",
    "name_en": "HistoCore MULTICUT",
    "category": "base",
    "description": "全自動旋轉式切片機",
    "is_base_unit": 1,
    "sort_order": 0,
    "suggested_price": 500000,
    "retail_price": 550000
  }
]`;

// ── 工具函式 ────────────────────────────────────────────────
function color(text, code) { return `\x1b[${code}m${text}\x1b[0m`; }
const bold  = t => color(t, '1');
const green = t => color(t, '32');
const red   = t => color(t, '31');
const cyan  = t => color(t, '36');
const yellow = t => color(t, '33');
const dim   = t => color(t, '2');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function fmtPrice(n) {
  if (!n) return dim('—');
  return new Intl.NumberFormat('zh-TW').format(n);
}

// ── 讀取 Excel ──────────────────────────────────────────────
function readExcel(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const workbook = XLSX.readFile(filePath, { cellDates: true });

  // 若有多個 sheet，優先找名稱含「產品」「Product」「商品」的
  let sheetName = workbook.SheetNames[0];
  for (const name of workbook.SheetNames) {
    if (/產品|product|商品|item/i.test(name)) { sheetName = name; break; }
  }

  const sheet = workbook.Sheets[sheetName];
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return { sheetName, rows };
}

// ── 呼叫 Claude API ─────────────────────────────────────────
async function analyzeWithClaude(client, rows, includePricing) {
  const sample = rows.slice(0, 3);
  const userMsg = `以下是 Excel 產品資料（共 ${rows.length} 筆），請分析欄位並轉換為系統格式。

欄位名稱：${Object.keys(rows[0] || {}).join('、')}

前3筆範例資料：
${JSON.stringify(sample, null, 2)}

完整資料（${rows.length} 筆）：
${JSON.stringify(rows, null, 2)}

${includePricing ? '請一併對應定價欄位。' : '此次不需要對應定價欄位。'}

請直接輸出 JSON 陣列，不要任何額外說明。`;

  const stream = await client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
  });

  process.stdout.write(cyan('\n🤖 Claude 分析中'));
  let text = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text;
      process.stdout.write('.');
    }
  }
  process.stdout.write(' 完成\n\n');

  // 清理 markdown 包裝
  const cleaned = text.replace(/^```[\w]*\n?/gm, '').replace(/```\s*$/gm, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 嘗試找 JSON 陣列
    const match = cleaned.match(/\[[\s\S]+\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Claude 回傳的資料無法解析為 JSON\n' + cleaned.slice(0, 500));
  }
}

// ── 驗證資料 ────────────────────────────────────────────────
function validateProducts(products) {
  const errors = [];
  const seen = new Set();

  products.forEach((p, i) => {
    const label = `[${i + 1}] ${p.catalog_number || '(無料號)'}`;
    if (!p.catalog_number) errors.push(`${label}: 缺少料號`);
    if (!p.name_zh)        errors.push(`${label}: 缺少中文名稱`);
    if (!VALID_CATEGORIES.includes(p.category)) {
      errors.push(`${label}: 類別無效 "${p.category}"（有效值：${VALID_CATEGORIES.join(', ')}）`);
    }
    if (seen.has(p.catalog_number)) errors.push(`${label}: 料號重複`);
    seen.add(p.catalog_number);
  });

  return errors;
}

// ── 顯示預覽表格 ────────────────────────────────────────────
function printPreview(products, includePricing) {
  console.log(bold(`\n📋 共解析 ${products.length} 筆產品資料：\n`));

  products.forEach((p, i) => {
    const catLabel = CATEGORY_LABELS[p.category] || p.category;
    const flags = [
      p.is_base_unit       ? yellow('【主機】') : '',
      p.is_included_in_base ? cyan('【含於基礎】') : '',
    ].filter(Boolean).join(' ');

    console.log(`${dim(String(i + 1).padStart(3, ' '))}. ${bold(p.catalog_number || '—')}  ${p.name_zh}`);
    console.log(`      ${dim('類別：')}${catLabel}  ${flags}`);
    if (p.name_en)     console.log(`      ${dim('英文：')}${p.name_en}`);
    if (p.description) console.log(`      ${dim('說明：')}${p.description}`);
    if (includePricing && (p.cost_price || p.suggested_price || p.retail_price)) {
      const parts = [];
      if (p.cost_price)      parts.push(`成本：${fmtPrice(p.cost_price)}`);
      if (p.min_sell_price)  parts.push(`最低：${fmtPrice(p.min_sell_price)}`);
      if (p.suggested_price) parts.push(`建議：${fmtPrice(p.suggested_price)}`);
      if (p.retail_price)    parts.push(`零售：${fmtPrice(p.retail_price)}`);
      console.log(`      ${dim('定價：')}${parts.join('  ')}`);
    }
    console.log('');
  });
}

// ── 寫入資料庫 ──────────────────────────────────────────────
function importToDb(products, includePricing) {
  const db = getDb();

  const insertProduct = db.prepare(`
    INSERT INTO products (catalog_number, name_zh, name_en, category, is_base_unit, is_included_in_base, description, notes, sort_order)
    VALUES (@catalog_number, @name_zh, @name_en, @category, @is_base_unit, @is_included_in_base, @description, @notes, @sort_order)
    ON CONFLICT(catalog_number) DO UPDATE SET
      name_zh             = excluded.name_zh,
      name_en             = excluded.name_en,
      category            = excluded.category,
      is_base_unit        = excluded.is_base_unit,
      is_included_in_base = excluded.is_included_in_base,
      description         = excluded.description,
      notes               = excluded.notes,
      sort_order          = excluded.sort_order
  `);

  const insertPricing = db.prepare(`
    INSERT INTO pricing (product_id, cost_price, min_sell_price, suggested_price, retail_price, currency)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `);

  const updatePricing = db.prepare(`
    UPDATE pricing SET cost_price=?, min_sell_price=?, suggested_price=?, retail_price=?, updated_at=CURRENT_TIMESTAMP
    WHERE product_id=?
  `);

  const getProductId = db.prepare('SELECT id FROM products WHERE catalog_number = ?');

  let inserted = 0, updated = 0, errors = [];

  const importAll = db.transaction(() => {
    for (const p of products) {
      try {
        const result = insertProduct.run({
          catalog_number:      p.catalog_number,
          name_zh:             p.name_zh,
          name_en:             p.name_en || '',
          category:            p.category,
          is_base_unit:        p.is_base_unit ? 1 : 0,
          is_included_in_base: p.is_included_in_base ? 1 : 0,
          description:         p.description || '',
          notes:               p.notes || '',
          sort_order:          p.sort_order ?? 99,
        });

        const productId = result.lastInsertRowid || getProductId.get(p.catalog_number).id;
        const isNew = result.changes === 1 && result.lastInsertRowid > 0;

        if (isNew) {
          inserted++;
          // 新產品建立定價列
          insertPricing.run(
            productId,
            p.cost_price || 0, p.min_sell_price || 0,
            p.suggested_price || 0, p.retail_price || 0,
            p.currency || 'TWD'
          );
        } else {
          updated++;
          // 更新已有產品的定價
          if (includePricing) {
            updatePricing.run(
              p.cost_price || 0, p.min_sell_price || 0,
              p.suggested_price || 0, p.retail_price || 0,
              productId
            );
          }
        }
      } catch (e) {
        errors.push(`${p.catalog_number}: ${e.message}`);
      }
    }
  });

  importAll();
  db.close();

  return { inserted, updated, errors };
}

// ── 主流程 ──────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const filePath   = args.find(a => !a.startsWith('--'));
  const isDryRun   = args.includes('--dry-run');
  const includePricing = args.includes('--pricing');

  console.log(bold('\n🔬 Leica 產品資料 AI 匯入工具'));
  console.log(dim('使用 Claude AI 智能解析 Excel 資料並匯入資料庫\n'));

  // 確認資料庫存在
  if (!fs.existsSync(DB_PATH)) {
    console.error(red('❌ 找不到資料庫，請先執行 node database/seed.js'));
    process.exit(1);
  }

  // 確認檔案
  if (!filePath) {
    console.log('用法：');
    console.log('  node cli/import-products.js <excel檔案> [--dry-run] [--pricing]\n');
    console.log('範例：');
    console.log('  node cli/import-products.js products.xlsx --pricing');
    console.log('  node cli/import-products.js products.xlsx --dry-run');
    process.exit(0);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(red(`❌ 找不到檔案：${absPath}`));
    process.exit(1);
  }

  // 確認 API Key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(red('❌ 請設定環境變數 ANTHROPIC_API_KEY'));
    console.error(dim('   export ANTHROPIC_API_KEY=sk-ant-...'));
    process.exit(1);
  }

  console.log(`${cyan('📂 檔案：')}${absPath}`);
  if (isDryRun)      console.log(yellow('🔍 DRY RUN 模式 — 不會寫入資料庫'));
  if (includePricing) console.log(cyan('💰 已啟用定價匯入'));
  console.log('');

  // 讀取 Excel
  let rows, sheetName;
  try {
    ({ sheetName, rows } = readExcel(absPath));
  } catch (e) {
    console.error(red('❌ 讀取 Excel 失敗：' + e.message));
    process.exit(1);
  }

  if (!rows.length) {
    console.error(red('❌ Excel 無資料'));
    process.exit(1);
  }

  console.log(`${green('✅')} 讀取工作表「${sheetName}」，共 ${bold(rows.length)} 列`);
  console.log(`${dim('   欄位：')}${Object.keys(rows[0]).join('、')}\n`);

  // 呼叫 Claude
  const client = new Anthropic({ apiKey });
  let products;
  try {
    products = await analyzeWithClaude(client, rows, includePricing);
  } catch (e) {
    console.error(red('❌ Claude 分析失敗：' + e.message));
    process.exit(1);
  }

  if (!Array.isArray(products) || products.length === 0) {
    console.error(red('❌ Claude 未回傳有效產品資料'));
    process.exit(1);
  }

  // 驗證
  const errors = validateProducts(products);
  if (errors.length) {
    console.log(red('⚠️  資料驗證警告：'));
    errors.forEach(e => console.log(red('  • ' + e)));
    console.log('');
  }

  // 顯示預覽
  printPreview(products, includePricing);

  if (isDryRun) {
    console.log(yellow('── DRY RUN 完成，未寫入資料庫 ──\n'));
    return;
  }

  // 詢問確認
  const validProducts = products.filter(p =>
    p.catalog_number && p.name_zh && VALID_CATEGORIES.includes(p.category)
  );

  if (validProducts.length !== products.length) {
    console.log(yellow(`⚠️  ${products.length - validProducts.length} 筆資料因驗證失敗將被略過，${validProducts.length} 筆有效`));
  }

  const answer = await ask(`\n${bold('確認匯入')} ${green(String(validProducts.length))} 筆產品？[y/N] `);
  if (answer.toLowerCase() !== 'y') {
    console.log(dim('\n已取消。\n'));
    return;
  }

  // 寫入資料庫
  console.log(cyan('\n💾 寫入資料庫…'));
  const { inserted, updated, errors: dbErrors } = importToDb(validProducts, includePricing);

  console.log(green(`\n✅ 匯入完成！`));
  console.log(`   ${green('新增：')}${inserted} 筆`);
  console.log(`   ${cyan('更新：')}${updated} 筆`);
  if (dbErrors.length) {
    console.log(red(`   錯誤：${dbErrors.length} 筆`));
    dbErrors.forEach(e => console.log(red('   • ' + e)));
  }
  console.log('');
}

main().catch(e => {
  console.error(red('\n❌ 發生錯誤：') + e.message);
  process.exit(1);
});
