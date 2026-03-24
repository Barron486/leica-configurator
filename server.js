require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const jwt        = require('jsonwebtoken');
const path       = require('path');

const { initSchema } = require('./database/schema');
initSchema();

const authRoutes    = require('./routes/auth');
const { JWT_SECRET } = require('./routes/auth');
const productRoutes = require('./routes/products');
const quoteRoutes   = require('./routes/quotes');
const adminRoutes   = require('./routes/admin');
const importRoutes  = require('./routes/import');
const bomRoutes      = require('./routes/bom');
const approvalRoutes = require('./routes/approvals');
const catalogRoutes  = require('./routes/catalog');

const app  = express();
const PORT = process.env.PORT || 3000;

// Railway / reverse proxy 環境需要 trust proxy
app.set('trust proxy', 1);

// ── 安全 Headers（helmet）────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:             ["'self'"],
      scriptSrc:              ["'self'", "'unsafe-inline'"],
      scriptSrcAttr:          ["'unsafe-inline'"],
      styleSrc:               ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:                ["'self'", "https://fonts.gstatic.com"],
      imgSrc:                 ["'self'", "data:"],
      connectSrc:             ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS（僅允許同源，正式環境可加白名單）──────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || false }));

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 登入限流：每 IP 15 分鐘內最多 10 次 ─────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登入嘗試過於頻繁，請 15 分鐘後再試' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── API 整體限流：每 IP 每分鐘最多 120 次 ────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: '請求過於頻繁，請稍後再試' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// ── JWT middleware ─────────────────────────────────────────────
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    } catch {}
  }
  next();
});

// ── 所有 /api 需登入（除 /api/auth）──────────────────────────
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  if (!req.user) return res.status(401).json({ error: '請先登入' });
  next();
});

app.use('/api/auth',          authRoutes);
app.use('/api/products',      productRoutes);
app.use('/api/quotes',        quoteRoutes);
app.use('/api/admin/import',  importRoutes);
app.use('/api/admin/boms',    bomRoutes);
app.use('/api/admin/catalog', catalogRoutes);
app.use('/api/approvals',    approvalRoutes);
app.use('/api/admin',         adminRoutes);

// ── SPA fallback ──────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
  console.log(`\n🔬 Leica 配置選擇器已啟動`);
  console.log(`   http://localhost:${PORT}\n`);
});
