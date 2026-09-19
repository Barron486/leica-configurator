# GENMALL GQC — 報價配置系統

> **正茂生物科技 · Quote & Config System**

以 Node.js + Express + SQLite 建構的內部報價管理平台，支援多角色權限、審批流程、產品 BOM 管理與 AI 輔助匯入。

---

## 目錄

- [快速啟動](#快速啟動)
- [環境變數](#環境變數)
- [系統架構](#系統架構)
- [角色與權限](#角色與權限)
- [審批流程](#審批流程)
- [API 路由總覽](#api-路由總覽)
- [目錄結構](#目錄結構)
- [部署說明（Railway）](#部署說明railway)

---

## 快速啟動

```bash
# 安裝相依套件
npm install

# 建立環境變數（見下方說明）
cp .env.example .env

# 啟動伺服器（預設 port 3000）
npm start

# 初始化範例資料（可選）
npm run seed
```

瀏覽器開啟 `http://localhost:3000` 即可進入登入頁。

---

## 環境變數

在專案根目錄建立 `.env` 檔案，填入以下設定：

```env
# 必填
JWT_SECRET=你的JWT密鑰（建議32位以上隨機字串）

# 選填 - 伺服器
PORT=3000
ALLOWED_ORIGIN=https://your-domain.com

# 選填 - Email 通知（SMTP）
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@example.com
SMTP_PASS=your_smtp_password
SMTP_FROM=noreply@example.com

# 選填 - AI 功能（產品匯入 / 客戶辨識）
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

> API 金鑰也可在後台「系統設定」（超級管理員專屬）介面中設定，儲存於資料庫。

---

## 系統架構

```
前端（純 HTML + Vanilla JS）
  ├── /login.html          登入頁
  ├── /index.html          報價配置頁（產品選擇 + 估價單預覽）
  ├── /products.html       產品目錄（公開瀏覽）
  ├── /quotes.html         我的報價單（業務 / 客戶）
  └── /admin.html          管理後台（依角色顯示不同 tab）

後端（Express）
  ├── routes/auth.js       登入 / JWT 驗證
  ├── routes/products.js   產品目錄 API（含關聯依賴）
  ├── routes/quotes.js     報價單 CRUD + 審批流程
  ├── routes/admin.js      管理員功能（用戶、產品、定價、角色權限）
  ├── routes/bom.js        BOM 管理
  ├── routes/approvals.js  審批人員設定
  ├── routes/customers.js  客戶資料管理
  ├── routes/import.js     Excel / PDF 產品匯入（AI 輔助）
  ├── routes/pm-import.js  PM 批次維護（價格 / 產品）
  ├── routes/notifications.js  系統通知
  └── routes/audit.js      稽核日誌（超級管理員專屬）

資料庫
  └── leica.db             SQLite 單一檔案，schema 自動遷移
```

---

## 角色與權限

| 角色 | 說明 | 可用功能 |
|------|------|---------|
| `super_admin` | 超級管理員 | 全部功能 + 系統設定 + 稽核日誌；唯一可指派 super_admin 的角色 |
| `admin` | 管理員 | 全部後台功能（除系統設定 / 稽核日誌外） |
| `sales` | 業務 | 配置報價、我的報價單、管理後台（報價管理） |
| `pm` | 產品經理 | 審核含其負責產品的 `pending_pm` 報價單、PM 批次維護 |
| `gm` | 總經理 | 審核 `pending_gm` 低毛利報價單 |
| `finance` | 財務部 | 審核 `submitted` 報價單 |
| `management` | 管理部 | 審核 `submitted` 報價單 |
| `customer` | 客戶 | 瀏覽產品目錄（零售價）、查看自己的報價單 |
| `demo` | 示範帳號 | 唯讀瀏覽 |

> 各角色的後台 tab 存取權限可由管理員在「角色權限」頁面調整。

---

## 審批流程

```
草稿（draft）
  │
  ▼ 提交
  ├─ 含 PM 負責產品 → pending_pm（等待 PM 審核）
  │     ├─ PM 核准，毛利率 ≥ 15% → submitted
  │     └─ PM 核准，毛利率 < 15% → pending_gm（等待總經理）
  │           └─ GM 核准 → submitted
  │
  └─ 無 PM 產品 → submitted（等待管理部用印）
        └─ 核准 → approved ✅
        └─ 退回 → rejected ❌

補充：
- admin / super_admin 可直接審核任何狀態的報價單
- 業務可在 pending / submitted 狀態撤回到草稿重新修改
- 退回時必須填寫退回原因
```

---

## API 路由總覽

### 認證
| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/auth/login` | 登入，回傳 JWT token |
| GET  | `/api/auth/me` | 取得當前用戶資訊 |

### 產品（公開）
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/products` | 取得所有啟用產品（含關聯依賴、定價） |

### 報價單
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/quotes` | 取得報價單列表（依角色過濾） |
| GET | `/api/quotes/my` | 取得自己的報價單 |
| GET | `/api/quotes/:id` | 取得報價單詳情（含品項） |
| POST | `/api/quotes` | 建立新報價單（草稿） |
| PUT | `/api/quotes/:id` | 更新草稿內容 |
| PUT | `/api/quotes/:id/submit` | 提交報價單（草稿→待審） |
| PUT | `/api/quotes/:id/withdraw` | 撤回報價單（回草稿） |
| PUT | `/api/quotes/:id/approve` | 審核：核准 |
| PUT | `/api/quotes/:id/reject` | 審核：退回 |
| DELETE | `/api/quotes/:id` | 刪除報價單 |

### 管理後台（需登入 + 對應權限）
| 方法 | 路徑 | 說明 |
|------|------|------|
| GET/POST | `/api/admin/products` | 產品管理 |
| PUT | `/api/admin/products/:id` | 修改產品 |
| DELETE | `/api/admin/products/:id` | 刪除產品 |
| PATCH | `/api/admin/products/:id/active` | 啟用/停用產品 |
| GET/POST/DELETE | `/api/admin/products/:id/dependencies` | 關聯產品管理 |
| PUT | `/api/admin/pricing/:product_id` | 更新定價 |
| GET/POST/PUT/DELETE | `/api/admin/users` | 用戶管理 |
| GET/PUT | `/api/admin/role-permissions` | 角色權限設定 |
| GET | `/api/admin/quotes` | 所有報價單（含毛利率） |

---

## 目錄結構

```
leica-configurator/
├── server.js              主伺服器入口
├── leica.db               SQLite 資料庫（自動建立）
├── package.json
├── .env                   環境變數（不納入版控）
├── Procfile               Railway 部署設定
│
├── database/
│   └── schema.js          資料庫 schema + 自動遷移
│
├── routes/                後端 API 路由
│   ├── auth.js
│   ├── products.js
│   ├── quotes.js
│   ├── admin.js
│   ├── bom.js
│   ├── approvals.js
│   ├── customers.js
│   ├── import.js
│   ├── pm-import.js
│   ├── notifications.js
│   ├── catalog.js
│   └── audit.js
│
├── public/                前端靜態檔案
│   ├── index.html         報價配置頁
│   ├── login.html
│   ├── products.html
│   ├── quotes.html
│   ├── admin.html         管理後台
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── auth.js        JWT 驗證 / 共用 helper
│       ├── configurator.js  配置報價主邏輯
│       ├── admin.js       管理後台主邏輯
│       └── theme.js       深色模式切換
│
├── utils/
│   └── audit.js           稽核日誌 helper
│
└── cli/
    ├── import-products.js  CLI 產品匯入工具
    └── create-sample.js    範例資料產生器
```

---

## 部署說明（Railway）

1. 建立 Railway 專案，連結此 GitHub repo
2. 設定環境變數（至少填入 `JWT_SECRET`）
3. 完成下方「網站入口保護」設定，再部署；缺少入口設定時全站會回覆無品牌資訊的 503
4. Railway 會自動執行 `Procfile` 中的 `npm start`
5. 資料庫使用 SQLite 單一檔案，重新部署不會遺失資料（需掛載 Volume）

> **注意**：若使用 Railway Volume，請將 `leica.db` 路徑設為 Volume 掛載路徑，避免重新部署時資料被清除。

### 網站入口保護

所有 HTML（含原本的登入頁）、CSS、JavaScript 與 API，必須先通過 Google Workspace 驗證。
訪客只能看到不帶公司名稱的 `/access` 入口；驗證失敗不顯示允許的網域、帳號資料或 Google 錯誤細節。
入口驗證通過後，仍須使用既有系統帳號登入，原本的角色與審批權限保持不變。

**部署前設定：**

1. 在公司 Google Cloud 專案建立 Web application OAuth 用戶端。若可用，將 OAuth audience 設成 Internal；對外可見的應用程式名稱使用中性名稱（例如 Private Portal），不要使用公司名稱、Logo 或公司描述。
2. 加入唯一且精確的 authorized redirect URI：`https://你的網站網域/access/callback`。
3. 在 Railway 設定 `SITE_ORIGIN`（例如 `https://你的網站網域`，不含路徑）、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_WORKSPACE_DOMAIN`（僅網域，不含 `@`）與 `SITE_SESSION_SECRET`。最後一項使用獨立隨機密鑰，至少 32 bytes，勿與 `JWT_SECRET` 共用；密鑰不得提交至 Git。
4. 確認公司 Google Workspace 的實際 hosted domain；伺服器驗證 Google 已簽章 ID token 的 `hd`、audience、issuer、有效期、nonce 與 `email_verified`，不以 email 後綴代替驗證，也不在公開 OAuth URL 放入公司網域提示。
5. Railway 健康檢查路徑設為 `/healthz`。這個端點只回傳 `ok` 或 `unavailable`。
6. **在 Cloudflare/CDN 對整個網站設定 bypass cache，清除部署前已快取的所有 HTML、JS、CSS。** 回應會帶有 private/no-store 與 CDN no-store headers，但既有快取或強制覆蓋 origin headers 的規則仍須處理。檢查自訂網域與 Railway 原始網域都不能繞過入口。
7. 用無痕視窗確認 `/login.html`、`/admin.html`、`/js/auth.js`、`/api/products` 無法直接取得內容；用非公司帳號確認拒絕存取，再用公司帳號完成真實登入驗收。

Cookie 使用 HttpOnly、Secure、SameSite=Lax、host-only；入口 session 最長 8 小時，登出會清除瀏覽器的入口 Cookie。OAuth 使用 state + 瀏覽器綁定、nonce、PKCE 與一次性 callback。待完成的 OAuth 流程只保存在單一程序記憶體中，**目前須維持一個 Railway replica**；多 replica 需先改用共用的一次性 flow store。部署重啟期間尚未完成的登入需重新開始。

本機開發亦需設定 OAuth，可使用 `http://localhost:3000` 與對應 callback；只有 loopback HTTP 允許非 Secure Cookie，沒有關閉入口驗證的開關。執行 `npm test` 可測試未登入存取、外部帳號、state/nonce、偽造或過期 Cookie、設定缺漏及快取標頭；測試使用模擬 Google 回應，正式 Google OAuth 與 CDN 仍需上線驗收。

網站入口保護無法移除公開 GitHub 原始碼、既有搜尋索引、網域名稱或歷史紀錄內的公司資訊。若儲存庫維持公開，README 與原始碼仍可直接閱讀；需另行調整儲存庫可見性。Google 管理的登入或 OAuth 畫面也須實際檢查顯示名稱。

---

## 版本紀錄

| 版本 | 說明 |
|------|------|
| 目前 | 關聯產品自動顯示於估價單、審批流程修正（PM/admin）、產品批次操作、超級管理員保護 |
| 前版 | 深色模式、品牌替換為正茂生物科技 / GENMALL GQC |
