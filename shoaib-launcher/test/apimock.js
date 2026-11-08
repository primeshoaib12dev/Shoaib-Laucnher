'use strict';
// Local fake Modrinth + CurseForge API (+ file hosting) for tests and the offline UI preview.
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { writeZip } = require('../src/core/zip');
const fs = require('fs');
const os = require('os');
const path = require('path');

const h = (algo, b) => crypto.createHash(algo).update(b).digest('hex');

async function startApiMock({ hang = false } = {}) {
  const files = {}; const log = [];
  let base;
  const mk = (name, size = 600) => { const buf = crypto.randomBytes(size); files['/files/' + name] = buf; return { filename: name, buf }; };
  const mrFile = (f) => ({ primary: true, filename: f.filename, url: base + '/files/' + f.filename, hashes: { sha1: h('sha1', f.buf), sha512: h('sha512', f.buf) }, size: f.buf.length });

  const server = http.createServer(async (req, res) => {
    if (hang) return; // never answers
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    let body = ''; for await (const c of req) body += c;
    log.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body: body ? JSON.parse(body) : null, headers: req.headers });
    const json = (o, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (files[p]) { res.writeHead(200, { 'Content-Length': files[p].length }); return res.end(files[p]); }
    // ---- Modrinth ----
    if (p === '/mr/search') return json({ total_hits: 2, hits: [
      { project_id: 'P1', slug: 'sodium', title: 'Sodium', author: 'jellysquid3', description: 'Rendering engine', icon_url: '', downloads: 90000, follows: 5000, project_type: (u.searchParams.get('facets') || '').includes('shader') ? 'shader' : 'mod', categories: ['fabric'] },
      { project_id: 'P3', slug: 'lithium', title: 'Lithium', author: 'jellysquid3', description: 'Game logic', icon_url: '', downloads: 5000, follows: 900, project_type: 'mod', categories: ['fabric'] }] });
    const proj = { P1: ['sodium', 'Sodium', 'mod'], P2: ['fabric-api', 'Fabric API', 'mod'], S1: ['bsl', 'BSL Shaders', 'shader'], R1: ['faithful', 'Faithful', 'resourcepack'], M1: ['cool-pack', 'Cool Pack', 'modpack'] };
    let m = /^\/mr\/project\/(\w+)$/.exec(p);
    if (m && proj[m[1]]) return json({ id: m[1], slug: proj[m[1]][0], title: proj[m[1]][1], description: 'd', icon_url: '', downloads: 1, follows: 1, project_type: proj[m[1]][2], categories: [] });
    m = /^\/mr\/project\/(\w+)\/version$/.exec(p);
    if (m) {
      const v = state.versions[m[1]]; return json(v ? v() : []);
    }
    m = /^\/mr\/version\/(\w+)$/.exec(p);
    if (m) { for (const k of Object.keys(state.versions)) for (const v of state.versions[k]()) if (v.id === m[1]) return json(v); return json({}, 404); }
    if (p === '/mr/version_files/update') { const out = {}; for (const hh of JSON.parse(body).hashes) if (state.updates[hh]) out[hh] = state.updates[hh](); return json(out); }
    if (p === '/mr/version_files') return json(state.identify(JSON.parse(body).hashes));
    // ---- CurseForge ----
    if (p.startsWith('/cf/')) {
      if (req.headers['x-api-key'] !== 'GOODKEY') return json({ error: 'forbidden' }, 403);
      if (p === '/cf/v1/games/432') return json({ data: { id: 432, name: 'Minecraft' } });
      if (p === '/cf/v1/mods/search') return json({ data: [{ id: 7, slug: 'jei', name: 'JEI', summary: 'items', authors: [{ name: 'mezz' }], downloadCount: 1e6, thumbsUpCount: 10, classId: 6, logo: null, links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' } }], pagination: { totalCount: 1 } });
      if (p === '/cf/v1/mods/7') return json({ data: { id: 7, slug: 'jei', name: 'JEI', summary: 's', authors: [], downloadCount: 1, classId: 6, links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' } } });
      if (p === '/cf/v1/mods/7/files') return json({ data: [{ id: 70, modId: 7, displayName: 'JEI 1', fileName: 'jei-1.jar', downloadUrl: null, fileDate: '2024-01-01', gameVersions: ['test-1.0', 'Fabric'], hashes: [], fileLength: 10, dependencies: [] }] });
      if (p === '/cf/v1/mods/8') return json({ data: { id: 8, slug: 'ok', name: 'Open Mod', summary: 's', authors: [], downloadCount: 1, classId: 6, links: {} } });
      if (p === '/cf/v1/mods/8/files') { const f = state.cfFile; return json({ data: [{ id: 80, modId: 8, displayName: 'Open 1', fileName: f.filename, downloadUrl: base + '/files/' + f.filename, fileDate: '2024-01-01', gameVersions: ['test-1.0', 'Fabric'], hashes: [{ algo: 1, value: h('sha1', f.buf) }], fileLength: f.buf.length, dependencies: [] }] }); }
    }
    res.writeHead(404); res.end('nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const sodium = mk('sodium-1.0.jar'); const sodium2 = mk('sodium-2.0.jar'); const fapi = mk('fabric-api-1.jar'); const shader = mk('bsl.zip'); const pack = mk('faithful.zip'); const cfOpen = mk('open-1.jar'); const bad = mk('tampered.jar');
  const state = {
    cfFile: cfOpen,
    versions: {
      P1: () => [{ id: 'V1', project_id: 'P1', name: 'Sodium 1.0', version_number: '1.0', game_versions: ['test-1.0'], loaders: ['fabric'], date_published: '2024-01-02', files: [mrFile(sodium)], dependencies: [{ project_id: 'P2', dependency_type: 'required' }, { project_id: 'PX', dependency_type: 'optional' }] }],
      P2: () => [{ id: 'V2', project_id: 'P2', name: 'FAPI', version_number: '1', game_versions: ['test-1.0'], loaders: ['fabric'], date_published: '2024-01-01', files: [mrFile(fapi)], dependencies: [] }],
      S1: () => [{ id: 'VS', project_id: 'S1', name: 'BSL', version_number: '8', game_versions: ['test-1.0'], loaders: ['iris'], date_published: '2024-01-01', files: [mrFile(shader)], dependencies: [] }],
      R1: () => [{ id: 'VR', project_id: 'R1', name: 'Faithful', version_number: '1', game_versions: ['test-1.0'], loaders: ['minecraft'], date_published: '2024-01-01', files: [mrFile(pack)], dependencies: [] }],
      BAD: () => [{ id: 'VB', project_id: 'BAD', name: 'Bad', version_number: '1', game_versions: ['test-1.0'], loaders: ['fabric'], date_published: '2024-01-01', files: [{ ...mrFile(bad), hashes: { sha1: '0'.repeat(40), sha512: '0'.repeat(128) } }], dependencies: [] }],
      EVIL: () => [{ id: 'VE', project_id: 'EVIL', name: 'Evil', version_number: '1', game_versions: ['test-1.0'], loaders: ['fabric'], date_published: '2024-01-01', files: [{ primary: true, filename: 'evil.jar', url: 'https://evil.example.com/evil.jar', hashes: { sha1: 'a'.repeat(40) }, size: 1 }], dependencies: [] }],
      M1: () => (files['/files/cool.mrpack'] = state.mrpackBuf || Buffer.alloc(1), [{ id: 'VM', project_id: 'M1', name: 'Cool 1', version_number: '1', game_versions: ['test-1.0'], loaders: ['fabric'], date_published: '2024-01-01', files: [mrFile({ filename: 'cool.mrpack', buf: state.mrpackBuf || Buffer.alloc(1) })], dependencies: [] }]),
    },
    updates: { [h('sha1', sodium.buf)]: () => ({ id: 'V1b', project_id: 'P1', name: 'Sodium 2.0', version_number: '2.0', game_versions: ['test-1.0'], loaders: ['fabric'], date_published: '2024-02-01', files: [mrFile(sodium2)], dependencies: [] }) },
    identify: () => ({}),
  };
  const buildMrpack = (opts = {}) => {
    const mod = mk('packmod.jar'); const f = { path: opts.evilPath || 'mods/packmod.jar', hashes: { sha1: h('sha1', mod.buf) }, env: { client: 'required', server: 'required' }, downloads: [opts.evilHost ? 'https://evil.example.com/x.jar' : base + '/files/packmod.jar'], fileSize: mod.buf.length };
    const idx = { formatVersion: 1, game: 'minecraft', versionId: '1', name: 'Test Pack', files: [f], dependencies: { minecraft: 'test-1.0', 'fabric-loader': opts.loader || '0.15' } };
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pk-')), 'test.mrpack');
    writeZip(out, [{ name: 'modrinth.index.json', data: Buffer.from(JSON.stringify(idx)) }, { name: 'overrides/config/pack.toml', data: Buffer.from('a=1') }, { name: 'client-overrides/options.txt', data: Buffer.from('lang:en_us') }]);
    return out;
  };
  return { base, log, state, files, sodium, sodium2, buildMrpack, h, urls: { modrinth: base + '/mr', curseforge: base + '/cf' }, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
module.exports = { startApiMock };
