'use strict';
// Local mock of the Mojang metadata/asset servers so the engine can be tested without internet.
const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const { osName } = require('../src/core/paths');

const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

function makeZip(files) { // store-only zip writer
  const locals = [], centrals = []; let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const nb = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, nb);
    off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

async function startMock({ flaky = {} } = {}) {
  const store = new Map();
  const hits = {};
  const handlers = {};
  const server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    if (handlers[req.url]) { const b = Buffer.from(JSON.stringify(handlers[req.url]())); res.writeHead(200); return res.end(b); }
    let buf = store.get(req.url);
    if (!buf) { res.writeHead(404); return res.end('nf'); }
    const f = flaky[req.url];
    if (f && f.fails > 0) { f.fails--; if (f.mode === '500') { res.writeHead(500); return res.end(); } if (f.mode === 'corrupt') buf = Buffer.alloc(buf.length, 7); }
    const range = /bytes=(\d+)-/.exec(req.headers.range || '');
    if (range && !(f && f.noRange)) { const s = +range[1]; res.writeHead(206, { 'Content-Range': `bytes ${s}-${buf.length - 1}/${buf.length}`, 'Content-Length': buf.length - s }); return res.end(buf.subarray(s)); }
    res.writeHead(200, { 'Content-Length': buf.length });
    if (f && f.slow) { let i = 0; const iv = setInterval(() => { if (i >= buf.length) { clearInterval(iv); return res.end(); } res.write(buf.subarray(i, i + 200)); i += 200; }, 20); res.on('close', () => clearInterval(iv)); return; }
    res.end(buf);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const put = (p, buf) => { store.set(p, buf); return { url: base + p, sha1: sha1(buf), size: buf.length, buf }; };

  const jar = put('/client.jar', crypto.randomBytes(5000));
  const lib = put('/libs/com/x/lib/1.0/lib-1.0.jar', crypto.randomBytes(3000));
  const nat = put(`/libs/org/lwjgl/lwjgl/3.3/lwjgl-3.3-natives-${osName()}.jar`, makeZip({ 'META-INF/MANIFEST.MF': Buffer.from('x'), 'liblwjgl.so': Buffer.from('ELFfake'), 'lwjgl.dll': Buffer.from('MZfake'), 'readme.txt': Buffer.from('no') }));
  const skipped = put('/libs/skip/me/1/me-1.jar', Buffer.from('should not download'));
  const objA = crypto.randomBytes(100), objB = crypto.randomBytes(200);
  const objects = { 'minecraft/a.ogg': { hash: sha1(objA), size: 100 }, 'minecraft/b.ogg': { hash: sha1(objB), size: 200 }, 'minecraft/dup.ogg': { hash: sha1(objA), size: 100 } };
  put(`/res/${sha1(objA).slice(0, 2)}/${sha1(objA)}`, objA);
  put(`/res/${sha1(objB).slice(0, 2)}/${sha1(objB)}`, objB);
  const idx = put('/assets/idx.json', Buffer.from(JSON.stringify({ objects })));
  const mavenLib = put('/maven/net/fab/loader/0.15/loader-0.15.jar', crypto.randomBytes(800));

  const ver = {
    id: 'test-1.0', type: 'release', mainClass: 'net.minecraft.client.main.Main', javaVersion: { majorVersion: 21 },
    assetIndex: { id: 'idx', url: idx.url, sha1: idx.sha1, size: idx.size, totalSize: 300 },
    downloads: { client: { url: jar.url, sha1: jar.sha1, size: jar.size } },
    arguments: {
      game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}',
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: ['--demo'] }],
      jvm: [{ rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['-XstartOnFirstThread'] }, '-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
    libraries: [
      { name: 'com.x:lib:1.0', downloads: { artifact: { path: 'com/x/lib/1.0/lib-1.0.jar', url: lib.url, sha1: lib.sha1, size: lib.size } } },
      { name: 'org.lwjgl:lwjgl:3.3:natives-' + osName(), downloads: { artifact: { path: `org/lwjgl/lwjgl/3.3/lwjgl-3.3-natives-${osName()}.jar`, url: nat.url, sha1: nat.sha1, size: nat.size } }, rules: [{ action: 'allow', os: { name: osName() } }] },
      { name: 'skip.me:me:1', downloads: { artifact: { path: 'skip/me/1/me-1.jar', url: skipped.url, sha1: skipped.sha1, size: skipped.size } }, rules: [{ action: 'allow' }, { action: 'disallow', os: { name: osName() } }] },
    ],
  };
  const verJson = put('/v/test-1.0.json', Buffer.from(JSON.stringify(ver)));
  const fabric = { id: 'fabric-test', inheritsFrom: 'test-1.0', type: 'release', mainClass: 'net.fabricmc.loader.Knot', arguments: { game: [], jvm: ['-DFabricMarker=1'] }, libraries: [{ name: 'net.fab:loader:0.15', url: base + '/maven/' }] };
  handlers['/manifest.json'] = () => ({ latest: { release: 'test-1.0', snapshot: 'test-1.0' }, versions: [{ id: 'test-1.0', type: 'release', url: verJson.url, sha1: verJson.sha1, releaseTime: '2024-01-01T00:00:00+00:00' }, { id: 'old-b1.0', type: 'old_beta', url: base + '/none', sha1: 'x', releaseTime: '2010-01-01T00:00:00+00:00' }] });

  return { base, hits, store, put, ver, fabric, jar, lib, nat, mavenLib, objects, objA, objB, verJson,
    urls: { manifest: base + '/manifest.json', resources: base + '/res', libraries: base + '/libs/' },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
module.exports = { startMock, makeZip, sha1 };
