import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { User } from '../src/models';
import { withMeta } from '../src/web';
import { type Member, type TestApp, createTestApp, onboard, signUp } from './helpers';

const SHELL = `<!doctype html><html lang="en"><head>
<title>SkillSwap</title>
<meta name="description" content="default description">
<meta property="og:title" content="SkillSwap">
<meta property="og:description" content="default description">
<meta property="og:url" content="/">
<meta property="og:image" content="/og-image.png">
</head><body><div id="root"></div></body></html>`;

const ASSET = `console.log(${JSON.stringify('x'.repeat(2000))});`;

let t: TestApp;
let clientDir: string;
let ana: Member;

beforeAll(async () => {
  clientDir = mkdtempSync(path.join(tmpdir(), 'skillswap-client-'));
  mkdirSync(path.join(clientDir, 'assets'));
  mkdirSync(path.join(clientDir, 'sandbox'));
  writeFileSync(path.join(clientDir, 'index.html'), SHELL);
  writeFileSync(path.join(clientDir, 'assets', 'app-abc123.js'), ASSET);
  // Distinct contents prove which copy was sent (the HTTP client decodes the body).
  writeFileSync(path.join(clientDir, 'assets', 'app-abc123.js.br'), brotliCompressSync('// br'));
  writeFileSync(path.join(clientDir, 'assets', 'app-abc123.js.gz'), gzipSync('// gz'));
  writeFileSync(path.join(clientDir, 'sandbox', 'runner.html'), '<!doctype html><script></script>');
  t = await createTestApp({ clientDir, env: { PUBLIC_URL: 'https://skillswap.test' } });
  ana = await signUp(t, { name: 'Ana <b>Lopez</b>', username: 'ana_lopez' });
  await onboard(ana, ['Java'], ['Figma']);
});
afterAll(async () => {
  await t.close();
  rmSync(clientDir, { recursive: true, force: true });
});

describe('static client and SEO', () => {
  it('serves the app shell for known routes and a real 404 for unknown ones', async () => {
    for (const url of ['/', '/discover', '/login', '/session/SWAP-DEMO-ROOM', '/settings']) {
      const res = await request(t.app).get(url);
      expect(res.status, url).toBe(200);
      expect(res.text).toContain('<div id="root">');
    }
    const unknown = await request(t.app).get('/this-does-not-exist');
    expect(unknown.status).toBe(404);
    expect(unknown.text).toContain('<div id="root">');
    // Known pages get an absolute canonical URL and share image; unknown ones are not canonicalised.
    const discover = await request(t.app).get('/discover/');
    expect(discover.text).toContain(
      '<link rel="canonical" href="https://skillswap.test/discover" />',
    );
    expect(discover.text).toContain('content="https://skillswap.test/og-image.png"');
    expect(unknown.text).not.toContain('rel="canonical"');
    expect((await request(t.app).get('/assets/missing.js')).status).toBe(404);
    expect((await request(t.app).get('/api/nope')).headers['content-type']).toMatch(/json/);
  });

  it('caches hashed assets forever and the shell never', async () => {
    const asset = await request(t.app).get('/assets/app-abc123.js');
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await request(t.app).get('/')).headers['cache-control']).toBe('no-cache');
  });

  it('sends the precompressed copy of an asset the browser can decode', async () => {
    const get = (acceptEncoding: string) =>
      request(t.app).get('/assets/app-abc123.js').set('Accept-Encoding', acceptEncoding);

    const br = await get('gzip, deflate, br');
    expect(br.headers['content-encoding']).toBe('br');
    expect(br.headers['content-type']).toMatch(/javascript/);
    expect(br.headers['cache-control']).toContain('immutable');
    expect(br.headers.vary).toMatch(/Accept-Encoding/i);
    expect(br.text).toBe('// br');

    const gz = await get('gzip');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(gz.text).toBe('// gz');

    const plain = await get('identity');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.text).toBe(ASSET);

    expect((await request(t.app).get('/assets/app-abc123.js.br/x')).status).toBe(404);
  });

  it('gives the code sandbox its own locked-down policy', async () => {
    const res = await request(t.app).get('/sandbox/runner.html');
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('connect-src');
    expect(csp).toContain("frame-ancestors 'self'");
    // The main app, in contrast, never allows eval or inline scripts.
    const main = (await request(t.app).get('/')).headers['content-security-policy'] ?? '';
    expect(main).toContain("script-src 'self'");
    expect(main).not.toContain('unsafe-eval');
  });

  it('injects escaped, per-member metadata into public profile pages', async () => {
    const res = await request(t.app).get('/profile/ana_lopez');
    expect(res.status).toBe(200);
    expect(res.text).toContain(
      '<title>Ana &lt;b&gt;Lopez&lt;/b&gt; (@ana_lopez) on SkillSwap</title>',
    );
    expect(res.text).not.toContain('<b>Lopez</b>');
    expect(res.text).toContain('teaches Java on SkillSwap');
    expect(res.text).toContain('content="https://skillswap.test/profile/ana_lopez"');
    expect(res.text).toContain(
      '<link rel="canonical" href="https://skillswap.test/profile/ana_lopez" />',
    );
    expect((await request(t.app).get('/profile/nobody_here')).status).toBe(404);
    expect((await request(t.app).get('/profile/%E0%A4%A')).status).toBe(404);
  });

  it('publishes robots.txt and a sitemap of public pages only', async () => {
    const robots = await request(t.app).get('/robots.txt');
    expect(robots.text).toContain('Disallow: /api/');
    expect(robots.text).toContain('Disallow: /admin');
    expect(robots.text).toContain('Sitemap: https://skillswap.test/sitemap.xml');

    const hidden = await signUp(t, { username: 'suspended_one' });
    await onboard(hidden, ['Java'], ['Figma']);
    await User.updateOne({ _id: hidden.user.id }, { status: 'SUSPENDED' });

    const sitemap = await request(t.app).get('/sitemap.xml');
    expect(sitemap.headers['content-type']).toMatch(/xml/);
    expect(sitemap.text).toContain('<loc>https://skillswap.test/</loc>');
    expect(sitemap.text).toContain('<loc>https://skillswap.test/profile/ana_lopez</loc>');
    expect(sitemap.text).not.toContain('suspended_one');
    expect(sitemap.text).not.toContain('/dashboard');
  });
});

describe('withMeta', () => {
  it('replaces every tag and escapes attribute breakers', () => {
    const html = withMeta(SHELL, {
      title: 'A "quoted" <title>',
      description: "it's",
      url: 'https://x.test/?a=1&b=2',
      origin: 'https://x.test',
    });
    expect(html).toContain('<title>A &quot;quoted&quot; &lt;title&gt;</title>');
    expect(html).toContain('<meta name="description" content="it&#39;s">');
    expect(html).toContain('<meta property="og:url" content="https://x.test/?a=1&amp;b=2">');
    expect(html).toContain('<link rel="canonical" href="https://x.test/?a=1&amp;b=2" />');
    expect(html).toContain('<meta property="og:image" content="https://x.test/og-image.png">');
    expect(html).not.toContain('default description');
  });

  it('keeps the default title and description when none are given', () => {
    const html = withMeta(SHELL, { url: 'https://x.test/discover', origin: 'https://x.test' });
    expect(html).toContain('<title>SkillSwap</title>');
    expect(html).toContain('default description');
    expect(html).toContain('<link rel="canonical" href="https://x.test/discover" />');
  });
});
