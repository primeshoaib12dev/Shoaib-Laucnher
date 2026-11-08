'use strict';
// Serves the UI and the backend over HTTP so the launcher can run in any browser (Termux on a phone, a headless box, ...).
// Security: token required for every /api call, same-origin only, loopback Host check, whitelist of methods (src/api.js).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { METHODS, EVENTS } = require('./api');
const { safeName } = require('./content');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const MAX_JSON = 5 * 1024 * 1024; const MAX_UPLOAD = 2 * 1024 * 1024 * 1024;

function startServer({ service, token, port = 0, host = '127.0.0.1' }) {
  const rendererDir = path.join(__dirname, 'renderer'); const assetsDir = path.join(__dirname, 'assets');
  const uploadsDir = path.join(service.d.root, 'cache', 'uploads'); const exportsDir = path.join(service.d.root, 'exports');
  const loopbackOnly = LOOPBACK.has(host);
  const sse = new Set();
  const tokenOk = (t) => { if (!t || !token) return false; const a = Buffer.from(String(t)), b = Buffer.from(token); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  const send = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(b); };

  const forward = (name) => (payload) => { const line = `data: ${JSON.stringify({ name, payload })}\n\n`; for (const r of sse) r.write(line); };
  const listeners = EVENTS.map((n) => [n, forward(n)]); for (const [n, f] of listeners) service.on(n, f);
  const beat = setInterval(() => { for (const r of sse) r.write(': ping\n\n'); }, 20000); beat.unref?.();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'); const p = url.pathname;
      const hostName = String(req.headers.host || '').replace(/:\d+$/, '');
      if (loopbackOnly && !LOOPBACK.has(hostName)) return send(res, 403, { ok: false, error: 'Forbidden host' });
      res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');

      if (p.startsWith('/api/')) {
        const t = req.headers['x-shoaib-token'] || url.searchParams.get('t');
        if (!tokenOk(t)) return send(res, 401, { ok: false, error: 'Missing or wrong access token. Open the link printed by the launcher (it ends with ?t=...).' });
        const origin = req.headers.origin; if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { ok: false, error: 'Cross-origin request blocked' });

        if (p === '/api/call' && req.method === 'POST') {
          let body = ''; let size = 0;
          for await (const c of req) { size += c.length; if (size > MAX_JSON) return send(res, 413, { ok: false, error: 'Request too large' }); body += c; }
          let j; try { j = JSON.parse(body); } catch { return send(res, 400, { ok: false, error: 'Invalid JSON' }); }
          if (!METHODS.has(j.method) || !Array.isArray(j.args || [])) return send(res, 400, { ok: false, error: `Unknown method ${j.method}` });
          try { const data = await service[j.method](...(j.args || [])); return send(res, 200, { ok: true, data: data === undefined ? null : data }); }
          catch (e) { return send(res, 200, { ok: false, error: e.message }); }
        }
        if (p === '/api/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write('retry: 2000\n\n'); sse.add(res); req.on('close', () => sse.delete(res)); return;
        }
        if (p === '/api/upload' && req.method === 'POST') {
          const name = safeName(url.searchParams.get('name') || 'upload'); fs.mkdirSync(uploadsDir, { recursive: true });
          const dest = path.join(uploadsDir, `${crypto.randomBytes(4).toString('hex')}-${name}`); const out = fs.createWriteStream(dest); let size = 0; let aborted = false;
          req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD && !aborted) { aborted = true; out.destroy(); fs.rmSync(dest, { force: true }); send(res, 413, { ok: false, error: 'File too large (max 2 GB)' }); req.destroy(); } });
          req.pipe(out); out.on('finish', () => { if (!aborted) send(res, 200, { ok: true, path: dest }); }); out.on('error', (e) => { if (!aborted) send(res, 500, { ok: false, error: e.message }); }); return;
        }
        if (p === '/api/download' && req.method === 'GET') {
          const f = path.resolve(String(url.searchParams.get('path') || '')); const base = path.resolve(exportsDir);
          if (!f.startsWith(base + path.sep) || !fs.existsSync(f)) return send(res, 404, { ok: false, error: 'File not found' });
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(f).size, 'Content-Disposition': `attachment; filename="${path.basename(f).replace(/"/g, '')}"` }); return fs.createReadStream(f).pipe(res);
        }
        return send(res, 404, { ok: false, error: 'Not found' });
      }

      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Method not allowed' });
      let file;
      if (p === '/') file = path.join(rendererDir, 'index.html');
      else if (p.startsWith('/assets/')) file = path.resolve(assetsDir, decodeURIComponent(p.slice('/assets/'.length)));
      else file = path.resolve(rendererDir, decodeURIComponent(p.slice(1)));
      const okBase = p.startsWith('/assets/') ? assetsDir : rendererDir;
      if (p.includes('\0') || !(file === path.join(rendererDir, 'index.html') || file.startsWith(path.resolve(okBase) + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(file).pipe(res);
    } catch (e) { try { send(res, 500, { ok: false, error: e.message }); } catch { /* socket gone */ } }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, port: server.address().port, host, token, exportsDir,
      url: `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}/?t=${token}`,
      close: () => new Promise((r) => { clearInterval(beat); for (const [n, f] of listeners) service.off(n, f); for (const x of sse) x.end(); server.closeAllConnections?.(); server.close(r); }) }));
  });
}
module.exports = { startServer };
