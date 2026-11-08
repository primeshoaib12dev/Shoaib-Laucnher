'use strict';
// Catches packaging mistakes: missing files, wrong relative paths, UI calling backend methods that do not exist.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('package.json: entry, scripts, build config and icons exist', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(fs.existsSync(path.join(root, pkg.main)), 'main exists');
  for (const s of ['start', 'start:proot', 'dist:win', 'dist:linux', 'test']) assert.ok(pkg.scripts[s], 'script ' + s);
  assert.ok(pkg.devDependencies.electron && pkg.devDependencies['electron-builder']);
  for (const f of ['build/icon.png', 'build/icon.ico', 'src/assets/icon.png', 'src/assets/bg.png']) assert.ok(fs.existsSync(path.join(root, f)), f);
  assert.ok(pkg.build.files.includes('src/**/*'));
});
test('renderer: html/css/js references resolve to real files', () => {
  const html = read('src/renderer/index.html'); const dir = path.join(root, 'src/renderer');
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) if (!/^https?:|^data:/.test(m[1])) assert.ok(fs.existsSync(path.join(dir, m[1])), 'html ref ' + m[1]);
  for (const m of read('src/renderer/style.css').matchAll(/url\("?([^")]+)"?\)/g)) if (!/^data:|^https?:/.test(m[1])) assert.ok(fs.existsSync(path.join(dir, m[1])), 'css ref ' + m[1]);
  for (const m of read('src/renderer/app.js').matchAll(/src: '(\.\.\/assets\/[^']+)'/g)) assert.ok(fs.existsSync(path.join(dir, m[1])), 'js ref ' + m[1]);
  assert.match(html, /Content-Security-Policy/);
});
test('every backend method the UI calls is exposed by main.js and exists on Service', () => {
  const api = read('src/api.js'); const app = read('src/renderer/app.js');
  const exposed = new Set([...api.slice(api.indexOf('new Set(['), api.indexOf(']);', api.indexOf('new Set(['))).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
  const called = new Set([...app.matchAll(/api\('([A-Za-z]+)'/g)].map((m) => m[1]));
  const { Service } = require('../src/service');
  for (const c of called) { assert.ok(exposed.has(c), `UI calls ${c} but main.js does not expose it`); assert.equal(typeof Service.prototype[c], 'function', `Service.${c} missing`); }
  for (const e of exposed) assert.equal(typeof Service.prototype[e], 'function', `exposed ${e} missing on Service`);
});
test('UI listens only to events that main.js forwards', () => {
  const api = read('src/api.js'); const app = read('src/renderer/app.js');
  const fwd = new Set([...api.slice(api.indexOf('const EVENTS')).split(';')[0].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]));
  for (const m of app.matchAll(/name === '([a-z-]+)'/g)) assert.ok(fwd.has(m[1]), `UI waits for event ${m[1]} that is never forwarded`);
});
test('preload exposes everything the UI uses from window.shoaib', () => {
  const pre = read('src/preload.js'); const app = read('src/renderer/app.js');
  for (const m of new Set([...app.matchAll(/window\.shoaib\.([A-Za-z]+)/g)].map((x) => x[1]))) assert.match(pre, new RegExp(`\\b${m}\\b`), `preload lacks ${m}`);
});
