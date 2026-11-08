'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { startMock } = require('./mock');
const { Service } = require('../src/service');
const { startServer } = require('../src/server');
const { El, Text, wait, buttonByText } = require('./fakedom');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shoaib-web-'));
const TOKEN = 'a'.repeat(48);
async function boot(urls) {
  const svc = new Service({ root: tmp(), urls });
  const s = await startServer({ service: svc, token: TOKEN });
  const base = `http://127.0.0.1:${s.port}`;
  const call = async (method, ...args) => (await (await fetch(base + '/api/call', { method: 'POST', headers: { 'x-shoaib-token': TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ method, args }) })).json());
  return { svc, s, base, call };
}
const rawGet = (port, p, headers) => new Promise((resolve) => { http.get({ host: '127.0.0.1', port, path: p, headers }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode, body: b, headers: r.headers })); }); });

test('web server: auth, host/origin checks, whitelist, static files, traversal', async () => {
  const { svc, s, base, call } = await boot();
  try {
    let r = await fetch(base + '/api/call', { method: 'POST', body: '{}' }); assert.equal(r.status, 401);
    r = await fetch(base + '/api/call', { method: 'POST', headers: { 'x-shoaib-token': 'b'.repeat(48) }, body: '{}' }); assert.equal(r.status, 401);
    assert.equal((await rawGet(s.port, '/api/events?t=' + TOKEN, { Host: 'evil.example.com' })).status, 403, 'DNS-rebinding style Host rejected');
    r = await fetch(base + '/api/call', { method: 'POST', headers: { 'x-shoaib-token': TOKEN, Origin: 'http://evil.example.com' }, body: '{"method":"getSettings","args":[]}' }); assert.equal(r.status, 403, 'cross-origin rejected');
    r = await fetch(base + '/api/call', { method: 'POST', headers: { 'x-shoaib-token': TOKEN }, body: 'nope' }); assert.equal(r.status, 400);
    r = await fetch(base + '/api/call', { method: 'POST', headers: { 'x-shoaib-token': TOKEN }, body: '{"method":"constructor","args":[]}' }); assert.equal(r.status, 400, 'only whitelisted methods');
    r = await fetch(base + '/api/call', { method: 'POST', headers: { 'x-shoaib-token': TOKEN }, body: '{"method":"_get","args":["x"]}' }); assert.equal(r.status, 400, 'internal methods not callable');
    const ok = await call('getSettings'); assert.equal(ok.ok, true); assert.equal(ok.data.ramMax, 2048);
    const bad = await call('createInstance', { name: '', mcVersion: '1.21' }); assert.equal(bad.ok, false); assert.match(bad.error, /name/);
    const pl = await call('getPlatform'); assert.equal(pl.data.canPlay, process.platform !== 'android');
    // static
    r = await fetch(base + '/'); const html = await r.text(); assert.equal(r.status, 200); assert.match(html, /Shoaib Launcher/); assert.match(html, /web-bridge\.js/);
    for (const [p, type] of [['/style.css', /css/], ['/app.js', /javascript/], ['/web-bridge.js', /javascript/], ['/assets/icon.png', /png/], ['/assets/bg.png', /png/]]) { r = await fetch(base + p); assert.equal(r.status, 200, p); assert.match(r.headers.get('content-type'), type); }
    for (const p of ['/..%2f..%2fpackage.json', '/assets/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/nothere.js', '/assets/']) assert.equal((await rawGet(s.port, p)).status, 404, 'blocked ' + p);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  } finally { await s.close(); }
});

test('web server: real calls, events (SSE), upload -> import, export -> download', async () => {
  const m = await startMock();
  const { svc, s, base, call } = await boot(m.urls);
  try {
    const v = await call('listVersions', {}); assert.ok(v.data.versions.some((x) => x.id === 'test-1.0'));
    // SSE
    const ctl = new AbortController(); const res = await fetch(base + '/api/events?t=' + TOKEN, { signal: ctl.signal }); assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    svc.emit('game-log', { instanceId: 'x', text: 'hello from game\n', stream: 'stdout' });
    const t0 = Date.now(); while (!buf.includes('hello from game') && Date.now() - t0 < 3000) { const { value } = await reader.read(); buf += dec.decode(value || new Uint8Array()); }
    assert.match(buf, /"name":"game-log"/); assert.match(buf, /hello from game/); ctl.abort();
    // upload -> import local mod
    const inst = (await call('createInstance', { name: 'Web', mcVersion: 'test-1.0', loader: 'fabric' })).data;
    const up = await (await fetch(base + '/api/upload?name=' + encodeURIComponent('../../evil mod.jar'), { method: 'POST', headers: { 'x-shoaib-token': TOKEN }, body: Buffer.from('jar-bytes') })).json();
    assert.equal(up.ok, true); assert.ok(up.path.startsWith(path.join(svc.d.root, 'cache', 'uploads')), 'upload stays in uploads dir'); assert.equal(fs.readFileSync(up.path, 'utf8'), 'jar-bytes');
    const imp = await call('contentImportLocal', inst.id, 'mod', up.path); assert.equal(imp.ok, true); assert.ok(fs.existsSync(path.join(inst.dir, 'mods', imp.data.filename)));
    // export + download
    const ep = (await call('exportPath', '../../Pack.mrpack')).data; assert.equal(path.dirname(ep), s.exportsDir); assert.equal(path.basename(ep), 'Pack.mrpack');
    assert.equal((await call('contentExportMrpack', inst.id, ep)).ok, true);
    let dl = await fetch(base + '/api/download?t=' + TOKEN + '&path=' + encodeURIComponent(ep)); assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition'), /Pack\.mrpack/); assert.ok((await dl.arrayBuffer()).byteLength > 20);
    dl = await fetch(base + '/api/download?t=' + TOKEN + '&path=' + encodeURIComponent(path.join(svc.d.root, 'accounts.json'))); assert.equal(dl.status, 404, 'only the exports folder is downloadable');
    dl = await fetch(base + '/api/download?t=' + TOKEN + '&path=' + encodeURIComponent(path.join(s.exportsDir, '..', 'settings.json'))); assert.equal(dl.status, 404);
  } finally { await s.close(); await m.close(); }
});

test('whole stack in a browser-like context: real UI + real bridge + real HTTP server', async () => {
  const m = await startMock();
  const { svc, s, base } = await boot(m.urls);
  try {
    El.ids = {};
    const doc = { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), getElementById: (id) => El.ids[id], addEventListener() {}, removeEventListener() {}, body: new El('body') };
    for (const id of ['topbar', 'view', 'toasts', 'modal-root', 'dl-status', 'pop-root']) { const e = new El('div'); e.setAttribute('id', id); }
    const store = {};
    class ES { constructor(u) { this.ctl = new AbortController(); (async () => { try { const r = await fetch(base + u, { signal: this.ctl.signal }); const rd = r.body.getReader(); const d = new TextDecoder(); let b = ''; for (;;) { const { value, done } = await rd.read(); if (done) break; b += d.decode(value); let i; while ((i = b.indexOf('\n\n')) > -1) { const chunk = b.slice(0, i); b = b.slice(i + 2); if (chunk.startsWith('data: ') && this.onmessage) this.onmessage({ data: chunk.slice(6) }); } } } catch { /* closed */ } })(); } }
    const win = {};
    const ctx = vm.createContext({ window: win, document: doc, location: { search: '?t=' + TOKEN, pathname: '/' }, history: { replaceState() {} }, sessionStorage: { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] || null }, fetch: (u, o) => fetch(base + u, o), EventSource: ES, alert() {}, prompt: () => null, setTimeout, clearTimeout, console, Promise, Error, Number, Object, Math, Date, encodeURIComponent, URLSearchParams });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/web-bridge.js'), 'utf8'), ctx);
    assert.equal(typeof win.shoaib.call, 'function'); assert.equal(win.shoaib.winControl, undefined, 'web mode has no window buttons');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8'), ctx);
    await wait(400);
    const v = () => El.ids.view; const tap = (t) => El.ids.topbar.find((e) => e.attrs.title === t)[0].click();
    assert.match(v().textContent, /Create profile/); assert.match(El.ids.topbar.textContent, /No account/);
    // add account through the UI -> persisted by the backend behind HTTP
    const chip = El.ids.topbar.find((e) => e.className === 'chip-acc')[0]; chip.click(); await wait(50);
    El.ids['pop-root'].find((e) => e.className === 'item')[0].click(); await wait(50);
    El.ids['modal-root'].find((e) => e.tag === 'input')[0].value = 'WebPlayer'; buttonByText(El.ids['modal-root'], 'Add').click(); await wait(500);
    assert.equal(svc.accounts.list()[0].name, 'WebPlayer'); assert.match(El.ids.topbar.textContent, /WebPlayer/);
    // create a profile through the UI and see the Download state
    svc.createInstance({ name: 'P', mcVersion: 'test-1.0' }); tap('Library'); await wait(100); tap('Home'); await wait(200);
    El.ids.topbar.find((e) => e.attrs.title === 'Settings')[0].click(); await wait(300);
    assert.match(v().textContent, /Network check/);
    assert.equal((await svc.contentDiagnose({ only: ['mojang'] })).length, 1);
    // an event pushed by the backend reaches the UI through SSE
    svc.emit('install-done', { instanceId: 'x', ok: true }); await wait(300);
    assert.match(El.ids.toasts.textContent, /Download complete/);
    // calling with a wrong token fails with a readable message
    const bad = vm.runInContext('(async()=>{ try { await window.shoaib.call("nope"); return "no error"; } catch(e){ return e.message; } })()', ctx); assert.match(await bad, /Unknown method/);
  } finally { await s.close(); await m.close(); }
});

test('android/Termux: rules treated as linux, playing blocked clearly, Java auto-install explained', async () => {
  const paths = require('../src/core/paths'); const { prepareLaunch } = require('../src/core/launch'); const java = require('../src/core/java'); const { installVersion } = require('../src/core/install'); const { dirs } = paths;
  const m = await startMock(); const t = tmp(); const d = dirs(t);
  try {
    await installVersion(d, 'test-1.0', { urls: m.urls, entry: { id: 'test-1.0', url: m.verJson.url, sha1: m.verJson.sha1 }, installJava: false });
    const real = process.platform; Object.defineProperty(process, 'platform', { value: 'android' });
    try {
      assert.equal(paths.osName(), 'linux'); assert.equal(paths.isAndroid(), true);
      await assert.rejects(prepareLaunch({ d, versionId: 'test-1.0', account: { type: 'offline', name: 'A', uuid: 'u' }, urls: m.urls }), /Playing is not possible here/);
      await assert.rejects(java.installRuntime(d, 21), /pkg install openjdk-21/);
      assert.equal(new Service({ root: tmp() }).getPlatform().canPlay, false);
    } finally { Object.defineProperty(process, 'platform', { value: real }); }
    assert.equal(paths.isAndroid(), false);
  } finally { await m.close(); }
});
