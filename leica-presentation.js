const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Leica 報價配置系統介紹";
pres.author = "Leica Biosystems";

// ─── 色彩系統 ───────────────────────────────────────────────
const C = {
  dark:      "1C2B4A",   // 深藍背景
  darkMid:   "253660",   // 側邊 / 次背景
  red:       "D92B2B",   // Leica 紅
  redLight:  "F5E6E6",   // 淡紅底
  white:     "FFFFFF",
  offWhite:  "F6F8FC",
  textDark:  "1A1A2E",
  textMid:   "4A5568",
  textLight: "8A9EC0",
  border:    "D9E2F0",
  blue:      "2B65B8",
  blueLight: "EAF1FB",
  green:     "1A8A5A",
  greenLight:"E6F7EF",
  orange:    "D97706",
  orangeLight:"FEF3C7",
  purple:    "6B3FA0",
  purpleLight:"F0EAF9",
};

// ─── 輔助：左側裝飾條 ──────────────────────────────────────
function addLeftBar(slide, color) {
  slide.addShape(slide._pptx ? slide._pptx.shapes.RECTANGLE : pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 0.12, h: 5.625,
    fill: { color }, line: { color }
  });
}

// ─── 輔助：深色頁首帶 ─────────────────────────────────────
function addHeader(slide, title, subtitle) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 10, h: 1.15,
    fill: { color: C.dark }, line: { color: C.dark }
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 1.15, w: 10, h: 0.05,
    fill: { color: C.red }, line: { color: C.red }
  });
  slide.addText(title, {
    x: 0.5, y: 0.15, w: 9, h: 0.6,
    fontSize: 26, bold: true, color: C.white,
    fontFace: "Calibri", align: "left", margin: 0
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5, y: 0.72, w: 9, h: 0.38,
      fontSize: 12, color: C.textLight,
      fontFace: "Calibri", align: "left", margin: 0
    });
  }
}

// ─── 輔助：卡片 ──────────────────────────────────────────
function addCard(slide, x, y, w, h, opts = {}) {
  const { bg = C.white, accent = null } = opts;
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: bg },
    line: { color: C.border, width: 1 },
    shadow: { type: "outer", blur: 5, offset: 2, angle: 135, color: "000000", opacity: 0.07 }
  });
  if (accent) {
    slide.addShape(pres.shapes.RECTANGLE, {
      x, y, w: 0.07, h,
      fill: { color: accent }, line: { color: accent }
    });
  }
}

// ─── 輔助：圓形數字徽章 ───────────────────────────────────
function addBadge(slide, x, y, num, color) {
  slide.addShape(pres.shapes.OVAL, {
    x, y, w: 0.4, h: 0.4,
    fill: { color }, line: { color }
  });
  slide.addText(String(num), {
    x, y: y + 0.03, w: 0.4, h: 0.36,
    fontSize: 13, bold: true, color: C.white,
    fontFace: "Calibri", align: "center", margin: 0
  });
}

// ─── 輔助：頁腳 ──────────────────────────────────────────
function addFooter(slide, pageNum) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.325, w: 10, h: 0.3,
    fill: { color: C.dark }, line: { color: C.dark }
  });
  slide.addText("Leica HistoCore MULTICUT 報價配置系統", {
    x: 0.4, y: 5.34, w: 7, h: 0.24,
    fontSize: 9, color: C.textLight, fontFace: "Calibri", align: "left", margin: 0
  });
  slide.addText(`${pageNum} / 12`, {
    x: 8.8, y: 5.34, w: 0.9, h: 0.24,
    fontSize: 9, color: C.textLight, fontFace: "Calibri", align: "right", margin: 0
  });
}

// ════════════════════════════════════════════════════════════
// Slide 1 — 封面
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  // 右側幾何裝飾
  s.addShape(pres.shapes.RECTANGLE, {
    x: 7.2, y: 0, w: 2.8, h: 5.625,
    fill: { color: C.darkMid }, line: { color: C.darkMid }
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 7.0, y: 0, w: 0.08, h: 5.625,
    fill: { color: C.red }, line: { color: C.red }
  });

  // 頂部紅色細條
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 7.0, h: 0.06,
    fill: { color: C.red }, line: { color: C.red }
  });

  // 主標題
  s.addText("Leica 報價", {
    x: 0.55, y: 1.1, w: 6.3, h: 0.95,
    fontSize: 52, bold: true, color: C.white,
    fontFace: "Calibri", align: "left", margin: 0
  });
  s.addText("配置系統", {
    x: 0.55, y: 2.0, w: 6.3, h: 0.95,
    fontSize: 52, bold: true, color: C.red,
    fontFace: "Calibri", align: "left", margin: 0
  });

  // 副標題
  s.addText("HistoCore MULTICUT · 功能介紹 · 系統架構 · 更新日誌", {
    x: 0.55, y: 3.1, w: 6.3, h: 0.45,
    fontSize: 14, color: C.textLight,
    fontFace: "Calibri", align: "left", margin: 0
  });

  // 右側欄位標籤
  const tags = ["功能介紹", "系統架構", "更新日誌"];
  tags.forEach((t, i) => {
    s.addText(t, {
      x: 7.25, y: 1.5 + i * 0.75, w: 2.5, h: 0.55,
      fontSize: 14, color: i === 0 ? C.red : C.textLight,
      fontFace: "Calibri", align: "center", bold: i === 0, margin: 0
    });
    if (i < 2) {
      s.addShape(pres.shapes.LINE, {
        x: 7.6, y: 2.0 + i * 0.75, w: 1.8, h: 0,
        line: { color: "2D3F60", width: 1 }
      });
    }
  });

  // 底部
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 5.2, w: 7.0, h: 0.425,
    fill: { color: "111824" }, line: { color: "111824" }
  });
  s.addText("2026  ·  醫療設備報價系統", {
    x: 0.55, y: 5.23, w: 6, h: 0.35,
    fontSize: 10, color: "4A5A70", fontFace: "Calibri", align: "left", margin: 0
  });
}

// ════════════════════════════════════════════════════════════
// Slide 2 — 目錄
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "目錄", "本次簡報涵蓋內容");
  addFooter(s, 2);

  const items = [
    { n: "01", label: "系統定位與概覽",   sub: "適用場景與核心價值",   color: C.red },
    { n: "02", label: "核心功能模組",      sub: "六大功能模組介紹",     color: C.blue },
    { n: "03", label: "配置與審批流程",    sub: "報價配置 + 多級審批",  color: C.green },
    { n: "04", label: "角色與權限",        sub: "9 種角色、雙重權限矩陣", color: C.orange },
    { n: "05", label: "AI Excel 匯入",    sub: "Claude AI 自動分析",   color: C.purple },
    { n: "06", label: "技術架構",          sub: "前後端 + 資料庫設計",  color: C.blue },
    { n: "07", label: "部署架構",          sub: "本機 → GitHub → Railway", color: C.green },
    { n: "08", label: "更新日誌",          sub: "v0.1 → v0.8 演進",   color: C.red },
  ];

  const cols = 2;
  const colW = 4.5;
  const rowH = 0.78;
  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.35 + col * (colW + 0.3);
    const y = 1.35 + row * (rowH + 0.12);

    addCard(s, x, y, colW, rowH, { bg: C.white, accent: it.color });
    s.addText(it.n, {
      x: x + 0.2, y: y + 0.12, w: 0.55, h: 0.35,
      fontSize: 18, bold: true, color: it.color,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(it.label, {
      x: x + 0.82, y: y + 0.1, w: colW - 1.0, h: 0.35,
      fontSize: 14, bold: true, color: C.textDark,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(it.sub, {
      x: x + 0.82, y: y + 0.44, w: colW - 1.0, h: 0.26,
      fontSize: 10, color: C.textMid,
      fontFace: "Calibri", align: "left", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 3 — 系統定位
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "系統定位與概覽", "Leica HistoCore MULTICUT 醫療設備報價管理平台");
  addFooter(s, 3);

  // 左側大卡片
  addCard(s, 0.35, 1.35, 4.5, 3.75, { bg: C.dark });
  s.addText("核心定位", {
    x: 0.6, y: 1.5, w: 4.0, h: 0.45,
    fontSize: 16, bold: true, color: C.red,
    fontFace: "Calibri", align: "left", margin: 0
  });
  s.addText([
    { text: "專為 Leica 切片機產品線設計的", options: { breakLine: true } },
    { text: "B2B 醫療設備報價配置系統", options: { breakLine: true, bold: true } },
    { text: " ", options: { breakLine: true } },
    { text: "從產品選擇、報價生成到", options: { breakLine: true } },
    { text: "多級審批，一站式完成", options: { breakLine: false } },
  ], {
    x: 0.6, y: 2.05, w: 4.0, h: 1.6,
    fontSize: 14, color: C.white,
    fontFace: "Calibri", align: "left"
  });

  const scenarios = ["醫院採購部門", "業務報價流程", "管理層審批", "財務定價管控"];
  scenarios.forEach((sc, i) => {
    const bx = 0.6;
    const by = 3.75 + i * 0.3;
    s.addShape(pres.shapes.RECTANGLE, {
      x: bx, y: by, w: 0.06, h: 0.22,
      fill: { color: C.red }, line: { color: C.red }
    });
    s.addText(sc, {
      x: bx + 0.15, y: by, w: 3.8, h: 0.24,
      fontSize: 12, color: C.textLight,
      fontFace: "Calibri", align: "left", margin: 0
    });
  });

  // 右側數字統計
  const stats = [
    { num: "9",   unit: "種角色",   sub: "細分權限管理",   color: C.red },
    { num: "4",   unit: "層定價",   sub: "成本→零售完整鏈", color: C.blue },
    { num: "11+", unit: "張資料表", sub: "完整業務資料模型", color: C.green },
    { num: "AI",  unit: "分析",    sub: "Claude 自動匯入", color: C.purple },
  ];
  stats.forEach((st, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 5.15 + col * 2.35;
    const y = 1.35 + row * 2.0;
    addCard(s, x, y, 2.15, 1.75, { bg: C.white });
    s.addText(st.num, {
      x, y: y + 0.2, w: 2.15, h: 0.75,
      fontSize: 44, bold: true, color: st.color,
      fontFace: "Calibri", align: "center", margin: 0
    });
    s.addText(st.unit, {
      x, y: y + 0.92, w: 2.15, h: 0.35,
      fontSize: 14, bold: true, color: C.textDark,
      fontFace: "Calibri", align: "center", margin: 0
    });
    s.addText(st.sub, {
      x, y: y + 1.28, w: 2.15, h: 0.3,
      fontSize: 10, color: C.textMid,
      fontFace: "Calibri", align: "center", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 4 — 核心功能模組
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "核心功能模組", "六大模組完整覆蓋業務流程");
  addFooter(s, 4);

  const modules = [
    { icon: "📋", title: "產品配置",     desc: "動態選擇主機+配件\n自動計算報價",     color: C.red },
    { icon: "📄", title: "報價單管理",   desc: "草稿→提交→審核\n支援 PDF 下載",       color: C.blue },
    { icon: "✅", title: "多級審批",     desc: "GM → PM → 財務\n三層審批鏈",         color: C.green },
    { icon: "👥", title: "角色權限",     desc: "9 種角色\n品牌+功能雙重矩陣",         color: C.orange },
    { icon: "🤖", title: "AI 匯入",      desc: "Claude 分析 Excel\n自動對應欄位",    color: C.purple },
    { icon: "🔔", title: "通知系統",     desc: "即時通知\n已讀狀態追蹤",             color: C.blue },
  ];

  const cols = 3;
  const cardW = 2.85;
  const cardH = 1.65;
  modules.forEach((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.35 + col * (cardW + 0.2);
    const y = 1.4 + row * (cardH + 0.22);

    addCard(s, x, y, cardW, cardH, { bg: C.white, accent: m.color });

    s.addText(m.icon, {
      x: x + 0.2, y: y + 0.18, w: 0.55, h: 0.5,
      fontSize: 22, align: "center", margin: 0
    });
    s.addText(m.title, {
      x: x + 0.82, y: y + 0.2, w: cardW - 1.0, h: 0.38,
      fontSize: 15, bold: true, color: C.textDark,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(m.desc, {
      x: x + 0.82, y: y + 0.62, w: cardW - 1.0, h: 0.9,
      fontSize: 11, color: C.textMid,
      fontFace: "Calibri", align: "left"
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 5 — 報價配置流程
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "報價配置流程", "從產品選擇到提交審核的完整流程");
  addFooter(s, 5);

  const steps = [
    { n: 1, title: "選擇產品",   desc: "從 BOM 目錄選擇儀器，系統自動預選主機與內含配件", color: C.red },
    { n: 2, title: "調整配置",   desc: "自訂單價、數量，實時計算報價總額，4層定價可見性控制", color: C.blue },
    { n: 3, title: "填寫客戶",   desc: "輸入客戶名稱、機構、聯絡資料及案件說明備註", color: C.green },
    { n: 4, title: "預覽下載",   desc: "預覽報價單，支援 PDF 下載，確認無誤後提交", color: C.orange },
    { n: 5, title: "提交審批",   desc: "報價狀態從草稿(draft)轉為提交(submitted)進入審批鏈", color: C.purple },
  ];

  steps.forEach((st, i) => {
    const y = 1.38 + i * 0.78;

    // 數字徽章
    addBadge(s, 0.35, y + 0.18, st.n, st.color);

    // 連接線（非最後一項）
    if (i < steps.length - 1) {
      s.addShape(pres.shapes.LINE, {
        x: 0.55, y: y + 0.58, w: 0, h: 0.58,
        line: { color: C.border, width: 1.5, dashType: "dash" }
      });
    }

    // 標題
    s.addText(st.title, {
      x: 0.9, y: y + 0.14, w: 2.0, h: 0.35,
      fontSize: 14, bold: true, color: C.textDark,
      fontFace: "Calibri", align: "left", margin: 0
    });

    // 描述卡
    addCard(s, 3.0, y + 0.06, 6.6, 0.62, { bg: C.white });
    s.addText(st.desc, {
      x: 3.15, y: y + 0.12, w: 6.3, h: 0.5,
      fontSize: 12, color: C.textMid,
      fontFace: "Calibri", align: "left", valign: "middle"
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 6 — 多級審批流程
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "多級審批流程", "報價單狀態流轉與審批鏈設計");
  addFooter(s, 6);

  // 狀態流程圖
  const states = [
    { label: "草稿",        sub: "draft",       color: C.textMid,  bg: C.border },
    { label: "已提交",      sub: "submitted",   color: C.blue,     bg: C.blueLight },
    { label: "總經理審核",  sub: "pending_gm",  color: C.orange,   bg: C.orangeLight },
    { label: "產品經理審核",sub: "pending_pm",  color: C.purple,   bg: C.purpleLight },
    { label: "已核准",      sub: "approved",    color: C.green,    bg: C.greenLight },
  ];

  const totalW = 9.2;
  const boxW = 1.55;
  const boxH = 1.0;
  const startX = 0.35;
  const y = 1.5;
  const gap = (totalW - states.length * boxW) / (states.length - 1);

  states.forEach((st, i) => {
    const x = startX + i * (boxW + gap);
    addCard(s, x, y, boxW, boxH, { bg: st.bg });
    s.addText(st.label, {
      x, y: y + 0.15, w: boxW, h: 0.38,
      fontSize: 12, bold: true, color: st.color,
      fontFace: "Calibri", align: "center", margin: 0
    });
    s.addText(st.sub, {
      x, y: y + 0.56, w: boxW, h: 0.3,
      fontSize: 9, color: C.textMid,
      fontFace: "Calibri", align: "center", margin: 0
    });
    // 箭頭
    if (i < states.length - 1) {
      s.addShape(pres.shapes.LINE, {
        x: x + boxW + 0.05, y: y + 0.5, w: gap - 0.1, h: 0,
        line: { color: C.textMid, width: 1.5 }
      });
      s.addText("▶", {
        x: x + boxW + gap / 2 - 0.13, y: y + 0.37, w: 0.26, h: 0.28,
        fontSize: 10, color: C.textMid, align: "left", margin: 0
      });
    }
  });

  // 駁回狀態
  addCard(s, 0.35, 2.75, 1.55, 0.85, { bg: C.redLight });
  s.addText("已駁回", {
    x: 0.35, y: 2.9, w: 1.55, h: 0.35,
    fontSize: 12, bold: true, color: C.red,
    fontFace: "Calibri", align: "center", margin: 0
  });
  s.addText("rejected", {
    x: 0.35, y: 3.24, w: 1.55, h: 0.26,
    fontSize: 9, color: C.textMid,
    fontFace: "Calibri", align: "center", margin: 0
  });

  s.addShape(pres.shapes.LINE, {
    x: 1.12, y: 2.5, w: 0, h: 0.25,
    line: { color: C.red, width: 1.5, dashType: "dash" }
  });
  s.addText("駁回", {
    x: 1.2, y: 2.53, w: 0.6, h: 0.22,
    fontSize: 9, color: C.red, fontFace: "Calibri", align: "left", margin: 0
  });

  // 審批規則說明
  const rules = [
    { label: "總經理", desc: "負責高金額報價或指定審批對象的最終核准" },
    { label: "產品經理", desc: "僅能審核自己負責品牌/產品的報價，跨品牌自動跳過" },
    { label: "審批歷史", desc: "每個審批步驟完整記錄操作者、時間、意見" },
  ];
  rules.forEach((r, i) => {
    const y2 = 3.75 + i * 0.5;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.35, y: y2 + 0.08, w: 0.06, h: 0.28,
      fill: { color: C.blue }, line: { color: C.blue }
    });
    s.addText(r.label, {
      x: 0.5, y: y2 + 0.06, w: 1.4, h: 0.3,
      fontSize: 12, bold: true, color: C.textDark,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(r.desc, {
      x: 2.0, y: y2 + 0.06, w: 7.6, h: 0.3,
      fontSize: 12, color: C.textMid,
      fontFace: "Calibri", align: "left", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 7 — 角色權限模型
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "角色與權限模型", "9 種角色 + 品牌 × 功能雙重權限矩陣");
  addFooter(s, 7);

  const roles = [
    { role: "super_admin", name: "超級管理員", perms: "完全控制所有功能",         color: C.red },
    { role: "admin",       name: "管理員",     perms: "用戶/產品/定價/報價管理",  color: C.blue },
    { role: "sales",       name: "業務代表",   perms: "建立報價、查看建議售價",   color: C.green },
    { role: "finance",     name: "財務",       perms: "審核報價、定價管理",       color: C.orange },
    { role: "gm",          name: "總經理",     perms: "高金額報價最終審批",       color: C.purple },
    { role: "pm",          name: "產品經理",   perms: "審核指定品牌產品報價",     color: C.blue },
    { role: "management",  name: "管理層",     perms: "報價審核",                color: C.green },
    { role: "customer",    name: "客戶",       perms: "查看零售價、提交報價",     color: C.orange },
    { role: "demo",        name: "示範帳號",   perms: "唯讀演示，不可寫入",      color: C.textMid },
  ];

  // 左側角色列表（3欄×3行）
  const colW = 2.9;
  const rowH = 0.88;
  roles.forEach((r, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 0.3 + col * (colW + 0.2);
    const y = 1.35 + row * (rowH + 0.12);

    addCard(s, x, y, colW, rowH, { bg: C.white, accent: r.color });
    s.addText(r.name, {
      x: x + 0.22, y: y + 0.1, w: colW - 0.35, h: 0.35,
      fontSize: 13, bold: true, color: C.textDark,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(r.role, {
      x: x + 0.22, y: y + 0.44, w: colW - 0.35, h: 0.22,
      fontSize: 9, color: r.color,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(r.perms, {
      x: x + 0.22, y: y + 0.64, w: colW - 0.35, h: 0.22,
      fontSize: 9, color: C.textMid,
      fontFace: "Calibri", align: "left", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 8 — AI Excel 匯入
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "AI Excel 匯入功能", "Claude AI 自動分析 Excel 並轉換為結構化產品資料");
  addFooter(s, 8);

  // 流程 3 步驟（橫向）
  const steps = [
    { n: "1", title: "上傳 Excel",  desc: "業務人員上傳產品\nExcel 檔（.xlsx）\n支援多種欄位命名格式", color: C.blue, icon: "📂" },
    { n: "2", title: "AI 分析",     desc: "Claude API 自動識別\n欄位對應關係\n提取4層定價資訊",    color: C.purple, icon: "🤖" },
    { n: "3", title: "預覽確認",    desc: "管理員預覽處理結果\n確認後批量匯入\n資料庫避免誤入",    color: C.green, icon: "✅" },
  ];

  steps.forEach((st, i) => {
    const x = 0.35 + i * 3.15;
    const y = 1.4;
    addCard(s, x, y, 2.9, 2.2, { bg: C.white, accent: st.color });

    s.addText(st.icon, {
      x, y: y + 0.18, w: 2.9, h: 0.55,
      fontSize: 28, align: "center", margin: 0
    });
    s.addText(st.title, {
      x, y: y + 0.76, w: 2.9, h: 0.4,
      fontSize: 15, bold: true, color: st.color,
      fontFace: "Calibri", align: "center", margin: 0
    });
    s.addText(st.desc, {
      x: x + 0.15, y: y + 1.2, w: 2.6, h: 0.9,
      fontSize: 11, color: C.textMid,
      fontFace: "Calibri", align: "center"
    });

    if (i < steps.length - 1) {
      s.addText("→", {
        x: x + 2.9 + 0.1, y: y + 0.9, w: 0.3, h: 0.4,
        fontSize: 22, color: C.textMid, align: "center", margin: 0
      });
    }
  });

  // 4層定價說明
  addCard(s, 0.35, 3.85, 9.3, 0.95, { bg: C.dark });
  s.addText("4 層定價結構", {
    x: 0.6, y: 3.95, w: 2.0, h: 0.35,
    fontSize: 13, bold: true, color: C.red,
    fontFace: "Calibri", align: "left", margin: 0
  });
  const prices = [
    { label: "成本價", sub: "cost_price",      color: C.red },
    { label: "最低售價", sub: "min_sell_price",  color: C.orange },
    { label: "建議報價", sub: "suggested_price", color: C.green },
    { label: "零售價",  sub: "retail_price",    color: C.blue },
  ];
  prices.forEach((p, i) => {
    const x = 2.7 + i * 1.75;
    s.addText(p.label, {
      x, y: 3.92, w: 1.6, h: 0.32,
      fontSize: 12, bold: true, color: p.color,
      fontFace: "Calibri", align: "center", margin: 0
    });
    s.addText(p.sub, {
      x, y: 4.27, w: 1.6, h: 0.28,
      fontSize: 9, color: C.textLight,
      fontFace: "Calibri", align: "center", margin: 0
    });
    if (i < prices.length - 1) {
      s.addText("→", {
        x: x + 1.6, y: 3.96, w: 0.15, h: 0.28,
        fontSize: 11, color: C.textLight, align: "center", margin: 0
      });
    }
  });
}

// ════════════════════════════════════════════════════════════
// Slide 9 — 技術架構
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "技術架構", "前後端分離 + SQLite + Claude AI 整合");
  addFooter(s, 9);

  // 三層架構
  const layers = [
    {
      title: "前端層",
      items: ["HTML5 + Vanilla JS", "無框架依賴，輕量快速", "index / admin / quotes / products", "JWT Token 認證管理"],
      color: C.blue, bg: C.blueLight, x: 0.35, y: 1.4, w: 2.8
    },
    {
      title: "後端層",
      items: ["Express.js v5 (Node.js)", "9 個 API 路由模組", "JWT 認證 + Role Middleware", "Multer 檔案上傳 10MB"],
      color: C.green, bg: C.greenLight, x: 3.6, y: 1.4, w: 2.8
    },
    {
      title: "資料層",
      items: ["SQLite (better-sqlite3)", "11+ 張核心資料表", "Schema Migration 系統", "Railway 持久磁碟 /data/"],
      color: C.orange, bg: C.orangeLight, x: 6.85, y: 1.4, w: 2.8
    }
  ];

  layers.forEach(l => {
    addCard(s, l.x, l.y, l.w, 2.5, { bg: l.bg });
    s.addShape(pres.shapes.RECTANGLE, {
      x: l.x, y: l.y, w: l.w, h: 0.55,
      fill: { color: l.color }, line: { color: l.color }
    });
    s.addText(l.title, {
      x: l.x, y: l.y + 0.1, w: l.w, h: 0.38,
      fontSize: 15, bold: true, color: C.white,
      fontFace: "Calibri", align: "center", margin: 0
    });
    l.items.forEach((item, i) => {
      s.addText([{ text: item, options: { bullet: true } }], {
        x: l.x + 0.2, y: l.y + 0.65 + i * 0.44, w: l.w - 0.3, h: 0.42,
        fontSize: 11, color: C.textDark,
        fontFace: "Calibri", align: "left"
      });
    });
  });

  // 安全與整合模組
  const extras = [
    { label: "安全防護", items: "Helmet CSP · CORS · Rate Limit · bcryptjs", color: C.red },
    { label: "AI 整合", items: "@anthropic-ai/sdk · Claude API · Excel 自動分析", color: C.purple },
    { label: "通訊服務", items: "Nodemailer SMTP · JWT 8h 過期 · nodemailer", color: C.blue },
  ];
  extras.forEach((e, i) => {
    const x = 0.35 + i * 3.15;
    addCard(s, x, 4.1, 2.9, 0.85, { bg: C.white, accent: e.color });
    s.addText(e.label, {
      x: x + 0.2, y: 4.18, w: 2.6, h: 0.3,
      fontSize: 12, bold: true, color: e.color,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(e.items, {
      x: x + 0.2, y: 4.52, w: 2.6, h: 0.36,
      fontSize: 10, color: C.textMid,
      fontFace: "Calibri", align: "left", margin: 0
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 10 — 資料庫設計
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "資料庫設計", "SQLite — 11+ 張資料表完整業務模型");
  addFooter(s, 10);

  const tables = [
    { name: "users",            desc: "用戶 · 角色 · 報價前綴",              color: C.red },
    { name: "products",         desc: "產品目錄 · 分類 · PM 負責人",         color: C.blue },
    { name: "pricing",          desc: "4層定價 · 貨幣",                      color: C.green },
    { name: "quotes",           desc: "報價主表 · 狀態流轉",                  color: C.orange },
    { name: "quote_items",      desc: "報價明細 · 單價快照",                  color: C.orange },
    { name: "quote_approvals",  desc: "審批歷史 · 操作記錄",                  color: C.purple },
    { name: "approval_chain",   desc: "審批鏈配置 · 執行順序",                color: C.purple },
    { name: "boms",             desc: "BOM 清單 · 儀器分類",                  color: C.blue },
    { name: "bom_items",        desc: "BOM 品項 · 數量",                     color: C.blue },
    { name: "brands",           desc: "品牌管理",                            color: C.green },
    { name: "notifications",    desc: "通知系統 · 已讀追蹤",                  color: C.red },
  ];

  // 兩欄顯示
  const col1 = tables.slice(0, 6);
  const col2 = tables.slice(6);
  const rowH = 0.64;

  [[col1, 0.35], [col2, 5.15]].forEach(([col, startX]) => {
    col.forEach((t, i) => {
      const y = 1.4 + i * (rowH + 0.05);
      addCard(s, startX, y, 4.5, rowH, { bg: C.white, accent: t.color });
      s.addText(t.name, {
        x: startX + 0.2, y: y + 0.1, w: 2.0, h: 0.3,
        fontSize: 12, bold: true, color: C.textDark,
        fontFace: "Calibri", align: "left", margin: 0
      });
      s.addText(t.desc, {
        x: startX + 2.3, y: y + 0.1, w: 2.1, h: 0.3,
        fontSize: 11, color: C.textMid,
        fontFace: "Calibri", align: "left", margin: 0
      });
    });
  });
}

// ════════════════════════════════════════════════════════════
// Slide 11 — 部署架構
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "部署架構", "本機開發 → GitHub 版本控制 → Railway 自動部署");
  addFooter(s, 11);

  // 三個主要節點
  const nodes = [
    {
      title: "本機開發",
      sub: "Local Development",
      items: ["Node.js + SQLite", "dotenv 環境變數", "git commit 版本控制"],
      color: C.blue, x: 0.35, y: 1.7
    },
    {
      title: "GitHub",
      sub: "Version Control",
      items: ["main 主分支", "git push 手動同步", "版本歷史與回溯"],
      color: C.textDark, x: 3.6, y: 1.7
    },
    {
      title: "Railway",
      sub: "Cloud Deployment",
      items: ["自動偵測 push 部署", "Procfile 啟動配置", "持久磁碟 /data/leica.db"],
      color: C.red, x: 6.85, y: 1.7
    }
  ];

  nodes.forEach((n, i) => {
    addCard(s, n.x, n.y, 2.8, 2.3, { bg: C.white });
    s.addShape(pres.shapes.RECTANGLE, {
      x: n.x, y: n.y, w: 2.8, h: 0.6,
      fill: { color: n.color }, line: { color: n.color }
    });
    s.addText(n.title, {
      x: n.x, y: n.y + 0.1, w: 2.8, h: 0.35,
      fontSize: 16, bold: true, color: C.white,
      fontFace: "Calibri", align: "center", margin: 0
    });
    s.addText(n.sub, {
      x: n.x, y: n.y + 0.45, w: 2.8, h: 0.2,
      fontSize: 9, color: "CCDDEE",
      fontFace: "Calibri", align: "center", margin: 0
    });
    n.items.forEach((item, j) => {
      s.addText([{ text: item, options: { bullet: true } }], {
        x: n.x + 0.25, y: n.y + 0.72 + j * 0.48, w: 2.4, h: 0.44,
        fontSize: 12, color: C.textDark,
        fontFace: "Calibri", align: "left"
      });
    });

    // 箭頭（節點間距 0.45"，用緊湊單字元 →）
    if (i < nodes.length - 1) {
      // → 符號置中於 gap（gap 起 n.x+2.8，終 n.x+3.25）
      s.addText("→", {
        x: n.x + 2.83, y: n.y + 0.96, w: 0.42, h: 0.38,
        fontSize: 18, bold: true, color: n.color, align: "center", margin: 0
      });
      const label = i === 0 ? "git push\n(手動)" : "Webhook\n(自動)";
      s.addText(label, {
        x: n.x + 2.82, y: n.y + 1.38, w: 0.42, h: 0.5,
        fontSize: 8, color: C.textMid,
        fontFace: "Calibri", align: "center"
      });
    }
  });

  // 說明區
  addCard(s, 0.35, 4.2, 9.3, 0.78, { bg: C.dark });
  s.addText("Procfile 啟動指令：", {
    x: 0.55, y: 4.32, w: 2.2, h: 0.32,
    fontSize: 12, bold: true, color: C.red,
    fontFace: "Calibri", align: "left", margin: 0
  });
  s.addText("web: node database/seed.js && node server.js", {
    x: 2.8, y: 4.32, w: 6.5, h: 0.32,
    fontSize: 12, color: C.textLight,
    fontFace: "Calibri", align: "left", margin: 0
  });
  s.addText("啟動時自動執行資料庫初始化與 Schema Migration，確保 Railway 每次部署後資料庫結構正確", {
    x: 0.55, y: 4.66, w: 9.0, h: 0.26,
    fontSize: 10, color: "5A7090",
    fontFace: "Calibri", align: "left", margin: 0
  });
}

// ════════════════════════════════════════════════════════════
// Slide 12 — 更新日誌
// ════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.offWhite };
  addHeader(s, "更新日誌", "v0.1 → v0.8 系統演進歷程");
  addFooter(s, 12);

  const logs = [
    { ver: "v0.8", title: "角色權限功能實裝",   desc: "後端 middleware + 前端動態 tabs",                    color: C.red },
    { ver: "v0.7", title: "業務報價單管理",     desc: "通知系統、case_notes、刪除報價、Email 通知",          color: C.blue },
    { ver: "v0.6", title: "審批鏈 Bug 修復",    desc: "修復 FOREIGN KEY 錯誤，super_admin canManage",      color: C.orange },
    { ver: "v0.5", title: "角色權限管理",       desc: "super_admin/demo 角色、匯出產品 Excel",             color: C.purple },
    { ver: "v0.4", title: "動態產品目錄",       desc: "BOM 大類動態顯示、instrument_category 儲存修復",     color: C.green },
    { ver: "v0.3", title: "報價編號系統",       desc: "估價單字軌 + 流水號報價編號 YYYYMMDD_prefix###",      color: C.blue },
    { ver: "v0.2", title: "UI 重設計 + AI 匯入", desc: "Schoger 18 原則 UI、網頁版 Excel 匯入、Claude 分析", color: C.orange },
    { ver: "v0.1", title: "基礎建設",          desc: "初始版本 + 登入安全 + Railway 部署 + Rate Limit 修復", color: C.textMid },
  ];

  const cols = 2;
  const cardW = 4.5;
  const cardH = 0.68;
  logs.forEach((lg, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.35 + col * (cardW + 0.3);
    const y = 1.38 + row * (cardH + 0.1);

    addCard(s, x, y, cardW, cardH, { bg: i === 0 ? C.redLight : C.white, accent: lg.color });

    s.addText(lg.ver, {
      x: x + 0.2, y: y + 0.1, w: 0.65, h: 0.32,
      fontSize: 13, bold: true, color: lg.color,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(lg.title, {
      x: x + 0.9, y: y + 0.1, w: cardW - 1.05, h: 0.3,
      fontSize: 12, bold: true, color: i === 0 ? C.textDark : C.textDark,
      fontFace: "Calibri", align: "left", margin: 0
    });
    s.addText(lg.desc, {
      x: x + 0.9, y: y + 0.42, w: cardW - 1.05, h: 0.24,
      fontSize: 10, color: C.textMid,
      fontFace: "Calibri", align: "left", margin: 0
    });
  });
}

// ─── 輸出 ──────────────────────────────────────────────────
pres.writeFile({ fileName: "leica-system-presentation.pptx" })
  .then(() => console.log("✅ 簡報已建立：leica-system-presentation.pptx"))
  .catch(e => console.error("❌ 錯誤：", e));
