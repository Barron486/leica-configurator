const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createSiteAccess } = require('../middleware/site-access');

const env = {
  SITE_ORIGIN: 'https://private.example', GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-client-secret', GOOGLE_WORKSPACE_DOMAIN: 'example.org',
  SITE_SESSION_SECRET: 'test-only-secret-with-at-least-32-bytes',
};

async function fixture(t, options = {}) {
  let authParams;
  let calls = 0;
  const oauthClient = {
    generateCodeVerifierAsync: async () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' }),
    generateAuthUrl(params) {
      authParams = params;
      return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(params)}`;
    },
    async getToken(params) {
      calls++;
      assert.equal(params.codeVerifier, 'verifier');
      return { tokens: { id_token: 'provider-token' } };
    },
    async verifyIdToken(params) {
      assert.equal(params.audience, env.GOOGLE_CLIENT_ID);
      assert.equal(params.idToken, 'provider-token');
      if (options.verifyError) throw new Error('invalid signature/audience/issuer/expiry');
      return { getPayload: () => ({ sub: 'test-user', hd: 'example.org', email_verified: true,
        nonce: authParams.nonce, ...options.identity }) };
    },
  };
  const app = express();
  app.use(createSiteAccess({ env: options.env || env, oauthClient }));
  app.use(express.static(path.join(__dirname, '../public')));
  app.post('/api/auth/login', (req, res) => res.json({ applicationReached: true }));
  app.get('/api/products', (req, res) => res.status(401).send('Application sign-in still required'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, init = {}) => fetch(origin + url, { redirect: 'manual', ...init });
  async function start() {
    const response = await request('/access/google');
    const location = new URL(response.headers.get('location'));
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    return { state: location.searchParams.get('state'), cookie, response, location };
  }
  const callback = (flow, init = {}) => request(`/access/callback?state=${flow.state}&code=test-code`,
    { headers: { cookie: flow.cookie }, ...init });
  return { request, start, callback, calls: () => calls };
}

test('anonymous requests cannot obtain pages, assets, APIs or application login', async t => {
  const f = await fixture(t);
  for (const url of ['/', '/login.html', '/admin.html', '/products.html', '/index.html',
    '/js/auth.js', '/js/admin.js', '/css/style.css', '/api/products', '/favicon.ico',
    '/LOGIN.HTML', '/%6cogin.html', '/access/../login.html']) {
    const res = await f.request(url);
    assert.ok([302, 401].includes(res.status), `${url}: ${res.status}`);
    assert.doesNotMatch(await res.text(), /genmall|正茂|GQC|Quote & Config/i);
    assert.match(res.headers.get('cache-control'), /no-store/);
  }
  const post = await f.request('/api/auth/login', { method: 'POST' });
  assert.equal(post.status, 401);
  const head = await f.request('/login.html', { method: 'HEAD' });
  assert.equal(head.status, 302);
  const range = await f.request('/js/auth.js', { headers: { Range: 'bytes=0-100' } });
  assert.equal(range.status, 401);
});

test('anonymous landing page and Google redirect reveal no company/domain hints', async t => {
  const f = await fixture(t);
  const response = await f.request('/access');
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /genmall|正茂|GQC|example.org|\/js\/|\/css\//i);
  const flow = await f.start();
  assert.equal(flow.location.hostname, 'accounts.google.com');
  assert.equal(flow.location.searchParams.has('hd'), false);
  assert.equal(flow.location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(flow.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(flow.response.headers.get('set-cookie'), /Secure/);
  assert.match(flow.response.headers.get('set-cookie'), /SameSite=Lax/);
});

test('verified Workspace account opens existing login/assets, preserves application auth and logs out', async t => {
  const f = await fixture(t);
  const flow = await f.start();
  const result = await f.callback(flow);
  assert.equal(result.status, 302);
  assert.equal(result.headers.get('location'), '/login.html');
  const cookie = result.headers.getSetCookie().find(c => c.startsWith('__Host-site_session=')).split(';')[0];
  const headers = { cookie };
  const page = await f.request('/login.html', { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /GENMALL/);
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.match(page.headers.get('vary'), /Cookie/);
  assert.equal((await f.request('/js/auth.js', { headers })).status, 200);
  assert.equal((await f.request('/api/products', { headers })).status, 401);
  assert.equal((await f.request('/access/logout', { method: 'POST', headers })).status, 403);
  const logout = await f.request('/access/logout', { method: 'POST', headers: { ...headers, origin: env.SITE_ORIGIN } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /__Host-site_session=;/);
  assert.equal((await f.request('/login.html')).status, 302);
});

for (const [name, identity] of Object.entries({
  'personal Google account with matching email suffix': { hd: undefined, email: 'person@example.org' },
  'external Workspace': { hd: 'other.org' },
  'lookalike Workspace': { hd: 'example.org.evil.test' },
  'unverified email': { email_verified: false },
  'missing subject': { sub: undefined },
  'wrong nonce': { nonce: 'incorrect' },
})) {
  test(`reject ${name}`, async t => {
    const f = await fixture(t, { identity });
    const response = await f.callback(await f.start());
    assert.equal(response.status, 403);
    assert.doesNotMatch(response.headers.get('set-cookie'), /site_session=/);
    assert.equal(await response.text(), 'Access denied');
  });
}

test('provider verification failure does not create a session', async t => {
  const f = await fixture(t, { verifyError: true });
  assert.equal((await f.callback(await f.start())).status, 403);
});

test('state must match browser cookie and each flow can be used only once', async t => {
  const f = await fixture(t);
  const flow = await f.start();
  assert.equal((await f.callback(flow, { headers: {} })).status, 403);
  assert.equal((await f.callback({ ...flow, state: 'bad-state' })).status, 403);
  assert.equal(f.calls(), 0);
  assert.equal((await f.callback(flow)).status, 302);
  assert.equal((await f.callback(flow)).status, 403);
  assert.equal(f.calls(), 1);
});

test('forged, expired, wrong-domain and application tokens cannot bypass entry', async t => {
  const f = await fixture(t);
  const payload = { kind: 'site-session', hd: 'example.org' };
  const opts = { subject: 'user', issuer: 'site-access', audience: 'site-access', expiresIn: 60 };
  for (const token of ['forged', jwt.sign(payload, 'wrong-key', opts),
    jwt.sign(payload, env.SITE_SESSION_SECRET, { ...opts, expiresIn: -1 }),
    jwt.sign({ ...payload, hd: 'external.org' }, env.SITE_SESSION_SECRET, opts),
    jwt.sign({ id: 1, role: 'super_admin' }, env.SITE_SESSION_SECRET)]) {
    assert.equal((await f.request('/login.html', { headers: { cookie: `__Host-site_session=${token}` } })).status, 302);
    assert.equal((await f.request('/api/auth/login', { method: 'POST', headers: { authorization: `Bearer ${token}` } })).status, 401);
  }
});

test('missing or invalid configuration fails closed for all application resources', async t => {
  for (const invalid of [{}, { ...env, GOOGLE_CLIENT_SECRET: '' }, { ...env, SITE_SESSION_SECRET: 'short' },
    { ...env, SITE_ORIGIN: 'http://public.example' }, { ...env, GOOGLE_WORKSPACE_DOMAIN: '' }]) {
    const f = await fixture(t, { env: invalid });
    for (const url of ['/login.html', '/js/auth.js', '/api/products', '/access', '/access/google']) {
      const res = await f.request(url);
      assert.equal(res.status, 503);
      assert.equal(await res.text(), 'Service unavailable');
    }
  }
});

test('health and robots disclose no branding or configuration', async t => {
  const f = await fixture(t);
  assert.equal(await (await f.request('/healthz')).text(), 'ok');
  assert.equal(await (await f.request('/robots.txt')).text(), 'User-agent: *\nDisallow: /\n');
});
