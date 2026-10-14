import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request } from 'express';
import type { AppContext } from './context';
import { User } from './models';

/** Routes the single-page app knows. Anything else is answered with a real 404 status. */
const CLIENT_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/(login|register|onboarding|dashboard|discover|exchanges|sessions|settings|admin)\/?$/,
  /^\/profile\/[^/]+\/?$/,
  /^\/session\/[^/]+\/?$/,
];

const PRIVATE_PATHS = [
  '/api/',
  '/dashboard',
  '/exchanges',
  '/sessions',
  '/session/',
  '/onboarding',
  '/settings',
  '/admin',
];

/** The sandbox page runs untrusted code, so it gets its own policy: no network, no parent access. */
const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; frame-ancestors 'self'";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeXml = escapeHtml;

function baseUrl(ctx: AppContext, req: Request): string {
  return ctx.env.publicUrl ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

/**
 * Fills in the per-page parts of the HTML shell: canonical and share URLs always, and the title
 * and description when the page has its own (public profiles).
 */
export function withMeta(
  html: string,
  meta: { url: string; origin: string; title?: string; description?: string },
): string {
  const url = escapeHtml(meta.url);
  let out = html
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    // Share previews need an absolute image address.
    .replace(
      /(<meta property="og:image" content=")(\/[^"]*)(")/,
      `$1${escapeHtml(meta.origin)}$2$3`,
    )
    .replace('</head>', `<link rel="canonical" href="${url}" /></head>`);
  if (meta.title !== undefined) {
    const title = escapeHtml(meta.title);
    out = out
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`);
  }
  if (meta.description !== undefined) {
    const description = escapeHtml(meta.description);
    out = out
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`);
  }
  return out;
}

/** Serves robots.txt, the sitemap, the built client and its HTML shell. */
export function mountWeb(app: Express, ctx: AppContext, clientDir: string | null): void {
  app.get('/robots.txt', (req, res) => {
    const lines = [
      'User-agent: *',
      'Allow: /',
      ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
      `Sitemap: ${baseUrl(ctx, req)}/sitemap.xml`,
      '',
    ];
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(lines.join('\n'));
  });

  app.get('/sitemap.xml', async (req, res) => {
    const base = baseUrl(ctx, req);
    const members = await User.find({ status: 'ACTIVE', role: 'USER', onboardingCompleted: true })
      .select('username updatedAt')
      .sort({ updatedAt: -1 })
      .limit(1000)
      .lean();
    const entry = (loc: string, lastmod?: Date) =>
      `  <url><loc>${escapeXml(base + loc)}</loc>${
        lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''
      }</url>`;
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      entry('/'),
      entry('/discover'),
      ...members.map((m) => entry(`/profile/${encodeURIComponent(m.username)}`, m.updatedAt)),
      '</urlset>',
      '',
    ].join('\n');
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(body);
  });

  if (!clientDir || !existsSync(path.join(clientDir, 'index.html'))) return;
  const shell = readFileSync(path.join(clientDir, 'index.html'), 'utf8');

  // The client build writes brotli and gzip copies of its hashed assets. Sending those saves the
  // CPU of compressing on every request, and brotli at maximum quality is smaller than on-the-fly gzip.
  const assetsDir = path.join(clientDir, 'assets');
  const precompressed = new Set(existsSync(assetsDir) ? readdirSync(assetsDir) : []);
  app.use('/assets', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const name = req.path.slice(1);
    if (name === '' || name.includes('/')) return next();
    res.vary('Accept-Encoding');
    // Browsers list gzip before br, so ask for brotli first rather than negotiating by order.
    const encoding = [
      { name: 'br', suffix: '.br' },
      { name: 'gzip', suffix: '.gz' },
    ].find((e) => req.acceptsEncodings(e.name) === e.name && precompressed.has(name + e.suffix));
    if (!encoding) return next();
    res.type(path.extname(name));
    res.setHeader('Content-Encoding', encoding.name);
    const file = path.join(assetsDir, name + encoding.suffix);
    res.sendFile(file, { maxAge: '1y', immutable: true }, (err) => {
      if (err && !res.headersSent) next();
    });
  });

  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders: (res, filePath) => {
        const relative = path.relative(clientDir, filePath).split(path.sep).join('/');
        if (relative.startsWith('assets/')) {
          // File names contain a content hash, so they can be cached forever.
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600');
        }
        if (relative === 'sandbox/runner.html') {
          res.setHeader('Content-Security-Policy', SANDBOX_CSP);
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  app.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    // A missing static file is a plain 404, not the app shell.
    if (path.extname(req.path) !== '') {
      res.status(404).type('text/plain').send('Not found');
      return;
    }

    const base = baseUrl(ctx, req);
    res.set('Cache-Control', 'no-cache');
    const known = CLIENT_ROUTES.some((route) => route.test(req.path));
    if (!known) {
      res.status(404).type('html').send(shell);
      return;
    }

    const profile = /^\/profile\/([^/]+)\/?$/.exec(req.path);
    if (profile?.[1]) {
      let username = '';
      try {
        username = decodeURIComponent(profile[1]).toLowerCase();
      } catch {
        // Malformed escape sequence: fall through to the not-found branch.
      }
      // Usernames from older versions may contain other characters; an exact string match is safe.
      const member =
        username !== '' && username.length <= 64
          ? await User.findOne({ username, status: 'ACTIVE' })
              .select('name username headline skillsTeaching')
              .lean()
          : null;
      if (!member) {
        res.status(404).type('html').send(shell);
        return;
      }
      const teaches = member.skillsTeaching.map((s) => s.skill).slice(0, 4);
      res.type('html').send(
        withMeta(shell, {
          title: `${member.name} (@${member.username}) on SkillSwap`,
          description:
            member.headline ||
            (teaches.length > 0
              ? `${member.name} teaches ${teaches.join(', ')} on SkillSwap.`
              : `${member.name} is a member of SkillSwap.`),
          url: `${base}/profile/${encodeURIComponent(member.username)}`,
          origin: base,
        }),
      );
      return;
    }

    res.type('html').send(
      withMeta(shell, {
        url: `${base}${req.path === '/' ? '/' : req.path.replace(/\/$/, '')}`,
        origin: base,
      }),
    );
  });
}
