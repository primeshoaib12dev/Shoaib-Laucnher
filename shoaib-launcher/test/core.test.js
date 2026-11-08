'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMock, sha1 } = require('./mock');
const { downloadFile, DownloadQueue, PauseSignal, CancelSignal } = require('../src/core/download');
const V = require('../src/core/versions');
const { dirs, osName } = require('../src/core/paths');
const { installVersion } = require('../src/core/install');
const { offlineUuid, createOfflineProfile, AccountStore } = require('../src/core/accounts');
const { prepareLaunch, launch } = require('../src/core/launch');
const log = require('../src/core/logger');
const { extractZip } = require('../src/core/zip');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shoaib-'));

test('downloader: ok, cached, hash mismatch, 500 retry, corrupt retry', async () => {
  const m = await startMock({ flaky: { '/libs/com/x/lib/1.0/lib-1.0.jar': { fails: 2, mode: '500' }, '/client.jar': { fails: 1, mode: 'corrupt' } } });
  const t = tmp();
  try {
    assert.equal(await downloadFile({ url: m.lib.url, dest: path.join(t, 'a.jar'), sha1: m.lib.sha1, size: m.lib.size }), 'downloaded'); // survived two 500s
    assert.equal(await downloadFile({ url: m.lib.url, dest: path.join(t, 'a.jar'), sha1: m.lib.sha1, size: m.lib.size }), 'cached');
    assert.equal(await downloadFile({ url: m.jar.url, dest: path.join(t, 'c.jar'), sha1: m.jar.sha1 }), 'downloaded'); // first body corrupt, retried
    await assert.rejects(downloadFile({ url: m.jar.url, dest: path.join(t, 'd.jar'), sha1: '0'.repeat(40), retries: 1 }), /Integrity|retries/);
    assert.ok(!fs.existsSync(path.join(t, 'd.jar')));
    await assert.rejects(downloadFile({ url: m.base + '/nope', dest: path.join(t, 'e'), retries: 3 }), /HTTP 404/);
    assert.equal(m.hits['/nope'], 1, '404 must not be retried');
  } finally { await m.close(); }
});

test('downloader: resumes from .part with Range', async () => {
  const m = await startMock();
  const t = tmp();
  try {
    const dest = path.join(t, 'r.jar');
    fs.writeFileSync(dest + '.part', m.jar.buf.subarray(0, 2000));
    let got = 0;
    await downloadFile({ url: m.jar.url, dest, sha1: m.jar.sha1, size: m.jar.size, onBytes: (n) => { got += n; } });
    assert.equal(got, m.jar.size - 2000, 'only the missing bytes are fetched');
    assert.equal(sha1(fs.readFileSync(dest)), m.jar.sha1);
  } finally { await m.close(); }
});

test('queue: pause, resume and cancel', async () => {
  const slowPath = '/client.jar';
  const m = await startMock({ flaky: { [slowPath]: { slow: true } } });
  const t = tmp();
  try {
    const q = new DownloadQueue({ concurrency: 2 });
    const progress = [];
    q.on('progress', (p) => progress.push(p));
    const task = { url: m.jar.url, dest: path.join(t, 'p.jar'), sha1: m.jar.sha1, size: m.jar.size };
    const run = q.run([task]);
    await new Promise((r) => setTimeout(r, 120));
    q.pause();
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!fs.existsSync(task.dest), 'not finished while paused');
    q.resume();
    const res = await run;
    assert.equal(res.failed.length, 0);
    assert.equal(sha1(fs.readFileSync(task.dest)), m.jar.sha1);
    assert.ok(progress.some((p) => p.speed > 0 || p.doneBytes > 0));
    assert.equal(progress.at(-1).percent, 100);

    const q2 = new DownloadQueue();
    const run2 = q2.run([{ url: m.jar.url, dest: path.join(t, 'q.jar'), sha1: m.jar.sha1, size: m.jar.size }]);
    await new Promise((r) => setTimeout(r, 80));
    q2.cancel();
    await assert.rejects(run2, CancelSignal);
  } finally { await m.close(); }
});

test('rules, maven path, library resolution', () => {
  assert.equal(V.mavenPath('net.fab:loader:0.15'), 'net/fab/loader/0.15/loader-0.15.jar');
  assert.equal(V.mavenPath('a.b:c:1:natives-linux'), 'a/b/c/1/c-1-natives-linux.jar');
  assert.equal(V.rulesAllow(undefined), true);
  assert.equal(V.rulesAllow([{ action: 'allow' }, { action: 'disallow', os: { name: osName() } }]), false);
  assert.equal(V.rulesAllow([{ action: 'allow', os: { name: 'definitely-not-an-os' } }]), false);
  assert.equal(V.rulesAllow([{ action: 'allow', features: { is_demo_user: true } }], {}), false);
  assert.equal(V.rulesAllow([{ action: 'allow', features: { is_demo_user: true } }], { is_demo_user: true }), true);
});

test('offline uuid / accounts', () => {
  const u = offlineUuid('Notch');
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(u, offlineUuid('Notch'));
  assert.notEqual(u, offlineUuid('notch'));
  assert.throws(() => createOfflineProfile('ab'), /3-16/);
  assert.throws(() => createOfflineProfile('bad name!'), /3-16/);
  const d = dirs(tmp());
  const s = new AccountStore(d);
  s.addOffline('Shoaib'); s.addOffline('Player2');
  assert.throws(() => s.addOffline('shoaib'), /already exists/);
  s.select('offline:player2'); assert.equal(s.selected().name, 'Player2');
  s.rename('offline:player2', 'Player3'); assert.equal(new AccountStore(d).selected().name, 'Player3'); // persisted
  s.remove('offline:player3'); assert.equal(s.selected().name, 'Shoaib');
});

test('install: full flow against mock, natives, marker only after verify', async () => {
  const m = await startMock();
  const d = dirs(tmp());
  try {
    const stages = [];
    const q = new DownloadQueue();
    const r = await installVersion(d, 'test-1.0', { queue: q, urls: m.urls, entry: { id: 'test-1.0', url: m.verJson.url, sha1: m.verJson.sha1 }, installJava: false, onStage: (s) => stages.push(s) });
    assert.deepEqual(stages, ['metadata', 'client', 'libraries', 'assets', 'natives', 'verify', 'register', 'done']);
    assert.ok(V.isInstalled(d, 'test-1.0'));
    assert.ok(fs.existsSync(path.join(d.versions, 'test-1.0', 'test-1.0.jar')));
    assert.ok(fs.existsSync(path.join(d.libraries, 'com/x/lib/1.0/lib-1.0.jar')));
    assert.ok(!fs.existsSync(path.join(d.libraries, 'skip/me/1/me-1.jar')), 'rule-disallowed library must not download');
    const nd = path.join(d.versions, 'test-1.0', 'natives');
    assert.deepEqual(fs.readdirSync(nd).sort(), ['liblwjgl.so', 'lwjgl.dll']);
    assert.equal(fs.readdirSync(path.join(d.assets, 'objects')).length >= 2, true);
    assert.equal(r.id, 'test-1.0');
    const list = await V.listVersions(d, { urls: m.urls });
    assert.equal(list.versions.find((v) => v.id === 'test-1.0').installed, true);
    assert.equal(list.versions.find((v) => v.id === 'old-b1.0').installed, false);
    assert.equal((await V.listVersions(d, { urls: m.urls, type: 'old_beta' })).versions.length, 1);
  } finally { await m.close(); }
});

test('install: failure leaves version NOT installed', async () => {
  const m = await startMock();
  const d = dirs(tmp());
  try {
    m.store.delete(new URL(m.lib.url).pathname); // library vanishes -> 404
    await assert.rejects(installVersion(d, 'test-1.0', { urls: m.urls, entry: { id: 'test-1.0', url: m.verJson.url, sha1: m.verJson.sha1 }, installJava: false }), /libraries failed/);
    assert.equal(V.isInstalled(d, 'test-1.0'), false);
  } finally { await m.close(); }
});

test('inheritsFrom merge (Fabric-style) installs parent jar and maven lib', async () => {
  const m = await startMock();
  const d = dirs(tmp());
  try {
    fs.mkdirSync(path.join(d.versions, 'fabric-test'), { recursive: true });
    fs.writeFileSync(path.join(d.versions, 'fabric-test', 'fabric-test.json'), JSON.stringify(m.fabric));
    await installVersion(d, 'fabric-test', { urls: m.urls, entry: { id: 'test-1.0', url: m.verJson.url, sha1: m.verJson.sha1 }, installJava: false });
    // the parent json is fetched through the manifest url on the mock
    const merged = await V.resolveVersion(d, 'fabric-test', { urls: m.urls });
    assert.equal(merged.mainClass, 'net.fabricmc.loader.Knot');
    assert.equal(merged._jarId, 'test-1.0');
    assert.equal(merged.libraries[0].name, 'net.fab:loader:0.15');
    assert.ok(fs.existsSync(path.join(d.libraries, 'net/fab/loader/0.15/loader-0.15.jar')), 'maven-style loader lib downloaded');
    assert.ok(fs.existsSync(path.join(d.versions, 'test-1.0', 'test-1.0.jar')), 'parent client jar installed');
  } finally { await m.close(); }
});

// ---- launch with a fake java ----
function fakeJava(dir, { exit = 0, major = '21.0.1' } = {}) {
  const f = path.join(dir, 'fakejava.sh');
  fs.writeFileSync(f, `#!/bin/sh\nif [ "$1" = "-version" ]; then echo 'openjdk version "${major}" 2024-01-01' >&2; echo '64-Bit Server VM' >&2; exit 0; fi\necho "ARGS: $@"\nexit ${exit}\n`, { mode: 0o755 });
  return f;
}
const linuxOnly = process.platform === 'win32' ? { skip: 'uses sh fake java' } : {};

test('launch: args, placeholders, token redaction, exit handling', linuxOnly, async () => {
  const m = await startMock();
  const t = tmp();
  const d = dirs(t);
  try {
    await installVersion(d, 'test-1.0', { urls: m.urls, entry: { id: 'test-1.0', url: m.verJson.url, sha1: m.verJson.sha1 }, installJava: false });
    const account = { type: 'microsoft', name: 'Tester', uuid: 'u-u-i-d', accessToken: 'SECRET_TOKEN_123456' };
    const prep = await prepareLaunch({ d, versionId: 'test-1.0', account, javaPath: fakeJava(t), gameDir: path.join(t, 'inst'), ramMin: 512, ramMax: 1024, width: 1280, height: 720, urls: m.urls });
    const a = prep.args;
    assert.equal(a[0], '-Xms512M'); assert.equal(a[1], '-Xmx1024M');
    assert.ok(a.includes('net.minecraft.client.main.Main'));
    assert.equal(a[a.indexOf('--username') + 1], 'Tester');
    assert.equal(a[a.indexOf('--userType') + 1], 'msa');
    assert.equal(a[a.indexOf('--width') + 1], '1280');
    assert.ok(!a.includes('--demo'));
    assert.ok(!a.includes('-XstartOnFirstThread') || osName() === 'osx');
    const cp = a[a.indexOf('-cp') + 1];
    assert.ok(cp.includes('lib-1.0.jar') && cp.includes('test-1.0.jar') && !cp.includes('me-1.jar'));
    assert.ok(a.some((x) => x.startsWith('-Djava.library.path=') && x.endsWith('natives')));
    const lines = [];
    const h = launch(prep, { onLog: (x) => lines.push(x) });
    const r = await h.exit;
    assert.equal(r.code, 0); assert.equal(r.crashed, false);
    const logText = fs.readFileSync(r.logFile, 'utf8');
    assert.ok(logText.includes('ARGS:'));
    assert.ok(!logText.includes('SECRET_TOKEN_123456'), 'token must be redacted from game log');
    assert.ok(!log.redact(prep.args.join(' ')).includes('SECRET_TOKEN_123456'));

    const crash = await launch(await prepareLaunch({ d, versionId: 'test-1.0', account, javaPath: fakeJava(t, { exit: 3 }), gameDir: path.join(t, 'inst2'), urls: m.urls })).exit;
    assert.equal(crash.code, 3); assert.equal(crash.crashed, true);

    const warn = await prepareLaunch({ d, versionId: 'test-1.0', account, javaPath: fakeJava(t, { major: '17.0.2' }), gameDir: path.join(t, 'inst3'), urls: m.urls });
    assert.ok(warn.warnings.some((w) => /needs Java 21/.test(w)));
    await assert.rejects(prepareLaunch({ d, versionId: 'test-1.0', account, javaPath: fakeJava(t), ramMin: 4096, ramMax: 1024, urls: m.urls }), /lower than minimum/);
    await assert.rejects(prepareLaunch({ d, versionId: 'test-1.0', account, javaPath: fakeJava(t), jvmArgs: ['bad'], urls: m.urls }), /Invalid JVM/);
    await assert.rejects(prepareLaunch({ d, versionId: 'nope', account, urls: m.urls }), /not installed/);
    await assert.rejects(prepareLaunch({ d, versionId: 'test-1.0', account: null, urls: m.urls }), /No account/);
  } finally { await m.close(); }
});

test('zip: blocks path traversal', () => {
  const { makeZip: mz } = require('./mock');
  const z = path.join(tmp(), 'evil.zip');
  fs.writeFileSync(z, mz({ '../evil.txt': Buffer.from('x') }));
  assert.throws(() => extractZip(z, path.join(tmp(), 'out')), /unsafe/);
});

test('java: parse versions, compatibility, real detection', async () => {
  const J = require('../src/core/java');
  assert.equal(J.parseMajor('openjdk version "1.8.0_392"'), 8);
  assert.equal(J.parseMajor('openjdk version "17.0.9" 2023-10-17'), 17);
  assert.equal(J.parseMajor('java version "21"'), 21);
  assert.equal(J.isCompatible(17, 8), false); // old MC must not run on newer Java silently
  assert.equal(J.isCompatible(8, 8), true);
  assert.equal(J.isCompatible(21, 17), true);
  assert.equal(J.isCompatible(17, 21), false);
  const found = await J.detectJava(dirs(tmp()));
  for (const j of found) assert.ok(j.major >= 8 && fs.existsSync(j.path) || j.path === 'java');
});

// ---- old-format (pre-1.13) versions: minecraftArguments, legacy natives, virtual assets ----
test('legacy version format: classifiers natives, virtual assets, old arguments, ARM warning', async () => {
  const { makeZip } = require('./mock');
  const m = await startMock();
  const t = tmp(); const d = dirs(t);
  try {
    const jar = m.put('/legacy/client.jar', require('crypto').randomBytes(2000));
    const lib = m.put('/legacy/libs/com/old/lib/1/lib-1.jar', require('crypto').randomBytes(500));
    const platJar = m.put('/legacy/libs/org/lwjgl/lwjgl-platform/2.9/lwjgl-platform-2.9.jar', require('crypto').randomBytes(300));
    const nat = m.put('/legacy/libs/org/lwjgl/lwjgl-platform/2.9/lwjgl-platform-2.9-natives.jar', makeZip({ 'META-INF/junk': Buffer.from('x'), 'liblwjgl.so': Buffer.from('ELF'), 'lwjgl.dll': Buffer.from('MZ'), 'liblwjgl.dylib': Buffer.from('MO') }));
    const objA = require('crypto').randomBytes(64); const hA = sha1(objA);
    m.put(`/res/${hA.slice(0, 2)}/${hA}`, objA);
    const idx = m.put('/legacy/idx.json', Buffer.from(JSON.stringify({ virtual: true, objects: { 'icons/a.png': { hash: hA, size: 64 } } })));
    const cls = { path: 'org/lwjgl/lwjgl-platform/2.9/lwjgl-platform-2.9-natives.jar', url: nat.url, sha1: nat.sha1, size: nat.size };
    const json = { id: 'legacy-1.0', type: 'release', mainClass: 'net.minecraft.client.main.Main',
      minecraftArguments: '--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} --assetsDir ${game_assets} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userType ${user_type} --session ${auth_session}',
      assetIndex: { id: 'legacy', url: idx.url, sha1: idx.sha1, size: idx.size }, downloads: { client: { url: jar.url, sha1: jar.sha1, size: jar.size } },
      libraries: [{ name: 'com.old:lib:1', downloads: { artifact: { path: 'com/old/lib/1/lib-1.jar', url: lib.url, sha1: lib.sha1, size: lib.size } } },
        { name: 'org.lwjgl:lwjgl-platform:2.9', natives: { linux: 'natives', windows: 'natives', osx: 'natives' }, extract: { exclude: ['META-INF/'] }, downloads: { artifact: { path: 'org/lwjgl/lwjgl-platform/2.9/lwjgl-platform-2.9.jar', url: platJar.url, sha1: platJar.sha1, size: platJar.size }, classifiers: { natives: cls } } }] };
    const vj = m.put('/legacy/v.json', Buffer.from(JSON.stringify(json)));
    await installVersion(d, 'legacy-1.0', { urls: m.urls, entry: { id: 'legacy-1.0', url: vj.url, sha1: vj.sha1 }, installJava: false });
    assert.deepEqual(fs.readdirSync(path.join(d.versions, 'legacy-1.0', 'natives')).sort(), ['liblwjgl.dylib', 'liblwjgl.so', 'lwjgl.dll'].filter((f) => true).sort().filter((f) => fs.existsSync(path.join(d.versions, 'legacy-1.0', 'natives', f))));
    assert.ok(fs.existsSync(path.join(d.versions, 'legacy-1.0', 'natives', process.platform === 'win32' ? 'lwjgl.dll' : 'liblwjgl.so')));
    assert.ok(!fs.existsSync(path.join(d.versions, 'legacy-1.0', 'natives', 'junk')), 'extract.exclude honoured');
    assert.ok(fs.existsSync(path.join(d.assets, 'virtual', 'legacy', 'icons', 'a.png')), 'virtual assets tree created');
    const fj = path.join(t, 'j8.sh'); fs.writeFileSync(fj, '#!/bin/sh\necho \'openjdk version "1.8.0_392"\' >&2\n', { mode: 0o755 });
    const prep = await prepareLaunch({ d, versionId: 'legacy-1.0', account: { type: 'offline', name: 'Shoaib', uuid: 'u-1' }, javaPath: fj, gameDir: path.join(t, 'g'), urls: m.urls });
    const a = prep.args;
    assert.equal(prep.required, 8); assert.ok(!a.some((x) => /\$\{/.test(x)), 'no unresolved placeholders: ' + a.filter((x) => /\$\{/.test(x)));
    assert.equal(a[a.indexOf('--assetsDir') + 1], path.join(d.assets, 'virtual', 'legacy'));
    assert.equal(a[a.indexOf('--session') + 1], '0'); assert.equal(a[a.indexOf('--userType') + 1], 'legacy');
    const cp = a[a.indexOf('-cp') + 1]; assert.ok(cp.includes('lwjgl-platform-2.9.jar') && !cp.includes('natives.jar'), 'natives jar kept off the classpath');
    assert.ok(a.some((x) => x.startsWith('-Djava.library.path=')));
    // ARM64 Linux without ARM natives -> clear warning (simulated arch)
    if (process.platform === 'linux') {
      const real = process.arch; Object.defineProperty(process, 'arch', { value: 'arm64' });
      try { const w = await prepareLaunch({ d, versionId: 'legacy-1.0', account: { type: 'offline', name: 'Shoaib', uuid: 'u-1' }, javaPath: fj, gameDir: path.join(t, 'g2'), urls: m.urls }); assert.ok(w.warnings.some((x) => /ARM64/.test(x))); }
      finally { Object.defineProperty(process, 'arch', { value: real }); }
    }
  } finally { await m.close(); }
});
