const express = require('express');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit');

const ISSUER = 'site-access';
const AUDIENCE = 'site-access';
const SESSION_MS = 8 * 60 * 60 * 1000;
const FLOW_MS = 10 * 60 * 1000;

function cookieValue(req, name) {
  const values = (req.headers.cookie || '').split(';')
    .map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0].slice(name.length + 1)); } catch { return null; }
}

function readConfig(env) {
  const origin = new URL(env.SITE_ORIGIN);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid SITE_ORIGIN');
  const domain = (env.GOOGLE_WORKSPACE_DOMAIN || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)) throw new Error('Missing workspace domain');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SITE_SESSION_SECRET ||
      Buffer.byteLength(env.SITE_SESSION_SECRET) < 32) throw new Error('Missing access configuration');
  return { origin: origin.origin, secure: !local, domain, clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET, secret: env.SITE_SESSION_SECRET };
}

// Runs BEFORE static files, JSON parsing and application APIs. Missing config fails closed.
function createSiteAccess({ env = process.env, oauthClient } = {}) {
  const router = express.Router();
  let config;
  try { config = readConfig(env); } catch {
    console.error('[site-access] Configure SITE_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_WORKSPACE_DOMAIN and SITE_SESSION_SECRET. Access is closed.');
  }
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config?.secure ?? true, path: '/' };
  const sessionName = config?.secure === false ? 'site_session' : '__Host-site_session';
  const flowName = config?.secure === false ? 'site_flow' : '__Host-site_flow';
  const client = config && (oauthClient || new OAuth2Client(config.clientId, config.clientSecret,
    `${config.origin}/access/callback`));
  // Only short-lived pending OAuth flows are retained; a restart safely requires retrying sign-in.
  const pending = new Map();
  function pruneFlows() {
    for (const [key, flow] of pending) if (flow.expires <= Date.now()) pending.delete(key);
  }
  function deny(res, status = 403) {
    return res.status(status).type('text').send(status === 503 ? 'Service unavailable' : 'Access denied');
  }
  function verifiedSession(req) {
    try {
      const payload = jwt.verify(cookieValue(req, sessionName), config.secret, {
        algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
      });
      return payload.kind === 'site-session' && payload.hd === config.domain &&
        typeof payload.sub === 'string' && payload.sub && payload;
    } catch { return null; }
  }

  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0',
      'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' });
    res.vary('Cookie');
    next();
  });
  router.get('/robots.txt', (req, res) => res.type('text').send('User-agent: *\nDisallow: /\n'));
  router.get('/healthz', (req, res) => res.status(config ? 200 : 503).type('text').send(config ? 'ok' : 'unavailable'));
  router.use((req, res, next) => config ? next() : deny(res, 503));
  router.use('/access', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30,
    standardHeaders: true, legacyHeaders: false, message: 'Too many requests' }));

  router.get('/access', (req, res) => {
    if (verifiedSession(req)) return res.redirect('/login.html');
    // No brand, company domain, application title or application assets before authentication.
    res.type('html').send('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Sign in</title><body><main><p>請先驗證身分。</p><a href="/access/google">使用 Google 帳號繼續</a></main></body></html>');
  });

  router.get('/access/google', async (req, res) => {
    pruneFlows();
    if (pending.size >= 10000) return deny(res, 503);
    try {
      const state = crypto.randomBytes(32).toString('base64url');
      const binding = crypto.randomBytes(32).toString('base64url');
      const nonce = crypto.randomBytes(32).toString('base64url');
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      pending.set(state, { binding, nonce, codeVerifier, expires: Date.now() + FLOW_MS });
      res.cookie(flowName, binding, { ...cookieOptions, maxAge: FLOW_MS });
      res.redirect(client.generateAuthUrl({ scope: ['openid', 'email'], state, nonce,
        prompt: 'select_account', code_challenge: codeChallenge, code_challenge_method: 'S256' }));
    } catch { return deny(res, 503); }
  });

  router.get('/access/callback', async (req, res) => {
    pruneFlows();
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const flow = pending.get(state);
    const binding = cookieValue(req, flowName);
    res.clearCookie(flowName, cookieOptions);
    if (!flow || !binding || binding !== flow.binding) return deny(res);
    pending.delete(state); // One-time flow; also consume provider-denied and failed exchanges.
    if (req.query.error || typeof req.query.code !== 'string' || !req.query.code) return deny(res);
    try {
      const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: flow.codeVerifier });
      if (!tokens.id_token) return deny(res);
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
      const identity = ticket.getPayload();
      // hd is Google's signed Workspace claim; an email suffix alone is not authorization.
      if (!identity || identity.hd !== config.domain || identity.email_verified !== true ||
          identity.nonce !== flow.nonce || typeof identity.sub !== 'string' || !identity.sub) return deny(res);
      const session = jwt.sign({ kind: 'site-session', hd: identity.hd }, config.secret, {
        algorithm: 'HS256', subject: identity.sub, issuer: ISSUER, audience: AUDIENCE,
        expiresIn: SESSION_MS / 1000,
      });
      res.cookie(sessionName, session, { ...cookieOptions, maxAge: SESSION_MS });
      return res.redirect('/login.html');
    } catch {
      // Do not send provider errors, tokens, account details or configuration to anonymous users.
      return deny(res);
    }
  });

  router.post('/access/logout', (req, res) => {
    if (req.get('origin') !== config.origin) return deny(res);
    res.clearCookie(sessionName, cookieOptions);
    res.clearCookie(flowName, cookieOptions);
    return res.sendStatus(204);
  });

  router.use((req, res, next) => {
    const identity = verifiedSession(req);
    if (identity) { req.siteIdentity = identity; return next(); }
    if (req.method === 'GET' || req.method === 'HEAD') {
      // Assets and APIs must never fall through to express.static or application routes.
      if (req.path === '/' || req.path.endsWith('.html')) return res.redirect('/access');
    }
    return deny(res, 401);
  });
  return router;
}

module.exports = { createSiteAccess };
