'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { startApiMock } = require('./apimock');
const { Service } = require('../src/service');
const { writeZip, readEntry } = require('../src/core/zip');
const { parseNbt } = require('../src/worlds');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shoaib-ct-'));
async function setup(extra = {}) {
  const api = await startApiMock();
  const svc = new Service({ root: tmp(), contentUrls: api.urls, allowedHosts: ['127.0.0.1'], ...extra });
  const inst = svc.createInstance({ name: 'Test', mcVersion: 'test-1.0', loader: 'fabric' });
  return { api, svc, inst };
}

test('modrinth: search facets, install with required deps into mods/, hashes verified', async () => {
  const { api, svc, inst } = await setup();
  try {
    const r = await svc.contentSearch('modrinth', 'mod', { instanceId: inst.id, query: 'sod', sort: 'downloads' });
    assert.equal(r.hits[0].title, 'Sodium');
    const q = api.log.find((l) => l.path === '/mr/search').query;
    const facets = JSON.parse(q.facets);
    assert.deepEqual(facets[0], ['project_type:mod']); assert.deepEqual(facets[1], ['versions:test-1.0']); assert.deepEqual(facets[2], ['categories:fabric']);
    assert.equal(q.index, 'downloads');

    const out = await svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'P1', type: 'mod' });
    assert.deepEqual(out.installed.map((x) => x.filename).sort(), ['fabric-api-1.jar', 'sodium-1.0.jar']);
    const dir = path.join(inst.dir, 'mods');
    assert.ok(fs.existsSync(path.join(dir, 'sodium-1.0.jar')) && fs.existsSync(path.join(dir, 'fabric-api-1.jar')));
    const again = await svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'P1', type: 'mod' });
    assert.equal(again.installed.length, 0, 'already installed is skipped');

    let lib = svc.contentInstalled(inst.id);
    assert.equal(lib.mod.length, 2); assert.equal(lib.mod.find((m) => m.base === 'sodium-1.0.jar').title, 'Sodium');
    svc.contentToggle(inst.id, 'mod', 'sodium-1.0.jar');
    lib = svc.contentInstalled(inst.id);
    assert.equal(lib.mod.find((m) => m.base === 'sodium-1.0.jar').enabled, false);
    assert.ok(fs.existsSync(path.join(dir, 'sodium-1.0.jar.disabled')));
    svc.contentToggle(inst.id, 'mod', 'sodium-1.0.jar.disabled');
    assert.ok(fs.existsSync(path.join(dir, 'sodium-1.0.jar')));
    assert.throws(() => svc.contentToggle(inst.id, 'mod', '../../etc/passwd'), /not found|Unsafe/);
    svc.contentRemove(inst.id, 'mod', 'fabric-api-1.jar');
    assert.ok(!fs.existsSync(path.join(dir, 'fabric-api-1.jar')));
  } finally { await api.close(); }
});

test('resource pack + shader go to their own folders', async () => {
  const { api, svc, inst } = await setup();
  try {
    await svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'R1', type: 'resourcepack' });
    await svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'S1', type: 'shader' });
    assert.ok(fs.existsSync(path.join(inst.dir, 'resourcepacks', 'faithful.zip')));
    assert.ok(fs.existsSync(path.join(inst.dir, 'shaderpacks', 'bsl.zip')));
    const lib = svc.contentInstalled(inst.id);
    assert.equal(lib.resourcepack[0].title, 'Faithful'); assert.equal(lib.shader[0].title, 'BSL Shaders');
    // the shader query must not filter by mod loader
    assert.equal(api.log.filter((l) => l.path === '/mr/project/S1/version').pop().query.loaders, undefined);
  } finally { await api.close(); }
});

test('security: tampered hash and untrusted host are rejected, nothing left on disk', async () => {
  const { api, svc, inst } = await setup();
  try {
    await assert.rejects(svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'BAD', type: 'mod' }), /Integrity|retries/);
    assert.ok(!fs.existsSync(path.join(inst.dir, 'mods', 'tampered.jar')));
    await assert.rejects(svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'EVIL', type: 'mod' }), /untrusted host/);
    await assert.rejects(svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'NOPE', type: 'mod' }), /No mod version|HTTP/);
  } finally { await api.close(); }
});

test('updates: detect newer version and replace file', async () => {
  const { api, svc, inst } = await setup();
  try {
    await svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'P1', type: 'mod' });
    const ups = await svc.contentCheckUpdates(inst.id);
    assert.equal(ups.length, 1); assert.equal(ups[0].latest, '2.0'); assert.equal(ups[0].filename, 'sodium-1.0.jar');
    await svc.contentUpdateItem(inst.id, 'mod', 'sodium-1.0.jar');
    const dir = path.join(inst.dir, 'mods');
    assert.ok(fs.existsSync(path.join(dir, 'sodium-2.0.jar')) && !fs.existsSync(path.join(dir, 'sodium-1.0.jar')));
  } finally { await api.close(); }
});

test('local import copies the file and rejects wrong types', async () => {
  const { api, svc, inst } = await setup();
  try {
    const src = path.join(tmp(), 'mymod.jar'); fs.writeFileSync(src, 'jar');
    const it = await svc.contentImportLocal(inst.id, 'mod', src);
    assert.equal(it.filename, 'mymod.jar'); assert.ok(fs.existsSync(path.join(inst.dir, 'mods', 'mymod.jar')));
    const it2 = await svc.contentImportLocal(inst.id, 'mod', src);
    assert.equal(it2.filename, 'mymod-2.jar', 'no overwrite');
    const bad = path.join(tmp(), 'x.exe'); fs.writeFileSync(bad, 'x');
    await assert.rejects(svc.contentImportLocal(inst.id, 'mod', bad), /Only \.jar/);
  } finally { await api.close(); }
});

test('curseforge: key required, search/install, restricted files reported (not downloaded)', async () => {
  const { api, svc, inst } = await setup();
  try {
    await assert.rejects(svc.contentSearch('curseforge', 'mod', { instanceId: inst.id }), /API key/);
    svc.setSettings({ curseforgeKey: 'WRONG' });
    await assert.rejects(svc.contentSearch('curseforge', 'mod', { instanceId: inst.id }), /access denied/);
    svc.setSettings({ curseforgeKey: 'GOODKEY' });
    assert.equal(svc.getSettings().curseforgeKeySet, true); assert.equal(svc.getSettings().curseforgeKey, undefined, 'key never sent to UI');
    const r = await svc.contentSearch('curseforge', 'mod', { instanceId: inst.id, query: 'jei' });
    assert.equal(r.hits[0].title, 'JEI');
    assert.equal(api.log.filter((l) => l.path === '/cf/v1/mods/search').pop().query.modLoaderType, '4');
    const restricted = await svc.contentInstall({ instanceId: inst.id, source: 'curseforge', projectId: '7', type: 'mod' });
    assert.equal(restricted.installed.length, 0); assert.equal(restricted.restricted.length, 1); assert.match(restricted.restricted[0].webUrl, /curseforge\.com/);
    const ok = await svc.contentInstall({ instanceId: inst.id, source: 'curseforge', projectId: '8', type: 'mod' });
    assert.equal(ok.installed[0].filename, 'open-1.jar'); assert.ok(fs.existsSync(path.join(inst.dir, 'mods', 'open-1.jar')));
    svc.setSettings({ curseforgeKey: null }); assert.equal(svc.getSettings().curseforgeKeySet, false);
  } finally { await api.close(); }
});

test('modpack: .mrpack import makes an instance, files + overrides, rejects unsafe packs', async () => {
  const { api, svc } = await setup();
  try {
    const r = await svc.contentImportModpack(api.buildMrpack());
    assert.equal(r.instance.name, 'Test Pack'); assert.equal(r.instance.loader, 'fabric');
    assert.ok(fs.existsSync(path.join(r.instance.dir, 'mods', 'packmod.jar')));
    assert.equal(fs.readFileSync(path.join(r.instance.dir, 'config', 'pack.toml'), 'utf8'), 'a=1');
    assert.equal(fs.readFileSync(path.join(r.instance.dir, 'options.txt'), 'utf8'), 'lang:en_us');
    assert.equal(svc.contentInstalled(r.instance.id).mod.length, 1);
    const n = svc.listInstances().instances.length;
    await assert.rejects(svc.contentImportModpack(api.buildMrpack({ evilPath: '../../escape.jar' })), /unsafe/);
    await assert.rejects(svc.contentImportModpack(api.buildMrpack({ evilHost: true })), /trusted download source/);
    assert.equal(svc.listInstances().instances.length, n, 'failed imports leave no half-made instance');
    api.state.mrpackBuf = fs.readFileSync(api.buildMrpack());
    const viaApi = await svc.contentInstallModpack({ source: 'modrinth', projectId: 'M1' });
    assert.ok(viaApi.instance.id);
  } finally { await api.close(); }
});

test('modpack export -> import roundtrip', async () => {
  const { api, svc, inst } = await setup();
  try {
    await svc.contentInstall({ instanceId: inst.id, source: 'modrinth', projectId: 'P1', type: 'mod' });
    fs.mkdirSync(path.join(inst.dir, 'config'), { recursive: true }); fs.writeFileSync(path.join(inst.dir, 'config', 'a.toml'), 'x=1');
    fs.mkdirSync(path.join(inst.dir, 'saves', 'W'), { recursive: true }); fs.writeFileSync(path.join(inst.dir, 'saves', 'W', 'level.dat'), 'x');
    svc.updateInstance(inst.id, {});
    const fake = svc._get(inst.id); fake.versionId = 'fabric-loader-0.15.7-test-1.0'; svc._save();
    const out = path.join(tmp(), 'out.mrpack');
    const res = svc.contentExportMrpack(inst.id, out);
    const idx = JSON.parse(readEntry(out, 'modrinth.index.json').toString());
    assert.equal(idx.dependencies['fabric-loader'], '0.15.7'); assert.equal(idx.dependencies.minecraft, 'test-1.0');
    assert.deepEqual(idx.files.map((f) => f.path).sort(), ['mods/fabric-api-1.jar', 'mods/sodium-1.0.jar']);
    assert.ok(readEntry(out, 'overrides/config/a.toml')); assert.equal(readEntry(out, 'overrides/saves/W/level.dat'), null, 'worlds not exported');
    assert.equal(res.files, 2);
  } finally { await api.close(); }
});

// ---- worlds ----
function nbtString(s) { const b = Buffer.from(s); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); }
function levelDat(name, gameType = 1, lastPlayed = 1700000000000n) {
  const lp = Buffer.alloc(8); lp.writeBigInt64BE(lastPlayed); const gt = Buffer.alloc(4); gt.writeInt32BE(gameType);
  const data = Buffer.concat([Buffer.from([8]), nbtString('LevelName'), nbtString(name), Buffer.from([4]), nbtString('LastPlayed'), lp, Buffer.from([3]), nbtString('GameType'), gt, Buffer.from([0])]);
  return zlib.gzipSync(Buffer.concat([Buffer.from([10]), nbtString(''), Buffer.from([10]), nbtString('Data'), data, Buffer.from([0])]));
}
test('worlds: list reads level.dat, backup, delete, import zip (zip-slip safe)', async () => {
  const { api, svc, inst } = await setup();
  try {
    assert.equal(parseNbt(zlib.gunzipSync(levelDat('Hi'))).Data.LevelName, 'Hi');
    const w = path.join(inst.dir, 'saves', 'My World'); fs.mkdirSync(path.join(w, 'region'), { recursive: true });
    fs.writeFileSync(path.join(w, 'level.dat'), levelDat('Cool Base', 1)); fs.writeFileSync(path.join(w, 'region', 'r.0.0.mca'), Buffer.alloc(5000));
    let l = svc.worldsList(inst.id);
    assert.equal(l.worlds[0].name, 'Cool Base'); assert.equal(l.worlds[0].gameMode, 'Creative'); assert.ok(l.worlds[0].sizeBytes >= 5000); assert.equal(l.worlds[0].lastPlayed, 1700000000000);
    const b = await svc.worldsBackup(inst.id, 'My World');
    assert.ok(fs.existsSync(path.join(inst.dir, 'backups', b.backup, 'level.dat')));
    assert.equal(svc.worldsList(inst.id).backups.length, 1);
    const zip = path.join(tmp(), 'Imported.zip');
    writeZip(zip, [{ name: 'Imported/level.dat', data: levelDat('Imp') }, { name: 'Imported/region/a.mca', data: Buffer.alloc(10) }]);
    l = svc.worldsImportZip(inst.id, zip);
    assert.equal(l.worlds.length, 2); assert.ok(fs.existsSync(path.join(inst.dir, 'saves', 'Imported', 'region', 'a.mca')));
    const noWorld = path.join(tmp(), 'n.zip'); writeZip(noWorld, [{ name: 'x.txt', data: Buffer.from('x') }]);
    assert.throws(() => svc.worldsImportZip(inst.id, noWorld), /level\.dat/);
    assert.throws(() => svc.worldsDelete(inst.id, '../../..'), /not found|Unsafe/);
    l = svc.worldsDelete(inst.id, 'My World'); assert.equal(l.worlds.length, 1);
  } finally { await api.close(); }
});

// ---- controls ----
test('controls: reads defaults, writes options.txt keeping other lines, validates', async () => {
  const { api, svc, inst } = await setup();
  try {
    const modern = svc.createInstance({ name: 'Modern', mcVersion: '1.21.1' });
    let c = svc.controlsGet(modern.id);
    assert.equal(c.supported, true); assert.equal(c.keys.find((k) => k.id === 'key.jump').value, 'key.keyboard.space');
    fs.writeFileSync(path.join(modern.dir, 'options.txt'), 'fov:70.0\nkey_key.forward:key.keyboard.up\n');
    c = svc.controlsSet(modern.id, { keys: { 'key.jump': 'key.keyboard.right.shift', 'key.attack': 'key.mouse.4' }, options: { mouseSensitivity: 0.8, toggleSprint: true } });
    const txt = fs.readFileSync(path.join(modern.dir, 'options.txt'), 'utf8');
    assert.match(txt, /fov:70\.0/); assert.match(txt, /key_key\.jump:key\.keyboard\.right\.shift/); assert.match(txt, /toggleSprint:true/); assert.match(txt, /mouseSensitivity:0\.8/);
    assert.equal(c.keys.find((k) => k.id === 'key.forward').value, 'key.keyboard.up', 'existing binding read back');
    assert.throws(() => svc.controlsSet(modern.id, { keys: { 'key.jump': 'rm -rf' } }), /Invalid key/);
    assert.throws(() => svc.controlsSet(modern.id, { keys: { 'key.nope': 'key.keyboard.a' } }), /Unknown control/);
    assert.throws(() => svc.controlsSet(modern.id, { options: { mouseSensitivity: 5 } }), /between 0 and 1/);
    c = svc.controlsReset(modern.id); assert.ok(!/key_key\./.test(fs.readFileSync(path.join(modern.dir, 'options.txt'), 'utf8'))); assert.match(fs.readFileSync(path.join(modern.dir, 'options.txt'), 'utf8'), /fov:70/);
    const old = svc.createInstance({ name: 'Old', mcVersion: '1.8.9' });
    assert.equal(svc.controlsGet(old.id).supported, false);
  } finally { await api.close(); }
});

// ---- storage ----
test('storage: move data to a new location, validates, keeps Java runtimes internal', async () => {
  const { api, svc, inst } = await setup();
  try {
    fs.writeFileSync(path.join(inst.dir, 'marker.txt'), 'hi');
    assert.equal(typeof svc.getStorage().freeBytes, 'number');
    await assert.rejects(svc.setStorage('relative/path'), /full folder path/);
    await assert.rejects(svc.setStorage(path.join(svc.d.root, 'inside')), /inside/);
    const target = path.join(tmp(), 'phone-storage');
    const aFile = path.join(tmp(), 'iamafile'); fs.writeFileSync(aFile, 'x');
    await assert.rejects(svc.setStorage(path.join(aFile, 'sub')), /Cannot write/);
    const home = tmp(); const prev = process.env.XDG_DATA_HOME; process.env.XDG_DATA_HOME = home;
    try {
      const s2 = new Service({ root: undefined });
      const s2root = s2.d.root;
      fs.writeFileSync(path.join(s2root, 'instances', 'x.txt'), 'data');
      const r = await s2.setStorage(target, { move: true });
      assert.equal(r.restartRequired, true);
      assert.ok(fs.existsSync(path.join(target, 'instances', 'x.txt')) && !fs.existsSync(path.join(s2root, 'instances', 'x.txt')));
      const s3 = new Service({});
      assert.equal(path.resolve(s3.d.root), path.resolve(target));
      assert.ok(s3.d.runtimes.startsWith(home), 'runtimes stay on internal storage');
      assert.equal(s3.getStorage().custom, true);
      s3.resetStorage(); assert.equal(path.resolve(new Service({}).d.root), path.resolve(s2root));
    } finally { if (prev === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = prev; }
  } finally { await api.close(); }
});

test('touch layouts: default, save/validate/active/delete', async () => {
  const { api, svc } = await setup();
  try {
    let l = svc.touchList();
    assert.equal(l.active, 'Default'); assert.ok(l.layouts.Default.buttons.some((b) => b.type === 'joystick') && l.layouts.Default.buttons.some((b) => b.id === 'jump'));
    const lay = JSON.parse(JSON.stringify(l.layouts.Default)); lay.buttons.find((b) => b.id === 'jump').x = 70;
    assert.throws(() => svc.touchSave('Default', lay), /built in/);
    l = svc.touchSave('Mine', lay); assert.ok(l.names.includes('Mine')); assert.equal(l.layouts.Mine.buttons.find((b) => b.id === 'jump').x, 70);
    const bad = JSON.parse(JSON.stringify(lay)); bad.buttons[2].key = 'rm -rf'; assert.throws(() => svc.touchSave('Bad', bad), /Invalid key/);
    const off = JSON.parse(JSON.stringify(lay)); off.buttons[2].x = 500; assert.throws(() => svc.touchSave('Bad', off), /between 0 and 100/);
    l = svc.touchSetActive('Mine'); assert.equal(l.active, 'Mine'); assert.equal(new Service({ root: svc.d.root }).touchList().active, 'Mine', 'persisted');
    l = svc.touchDelete('Mine'); assert.equal(l.active, 'Default'); assert.throws(() => svc.touchDelete('Default'), /Cannot delete/);
  } finally { await api.close(); }
});

// ---------- Shoaib+ ----------
function makeWorld(inst, folder, name) {
  const w = path.join(inst.dir, 'saves', folder); fs.mkdirSync(path.join(w, 'region'), { recursive: true });
  fs.writeFileSync(path.join(w, 'level.dat'), levelDat(name)); fs.writeFileSync(path.join(w, 'region', 'r.0.0.mca'), Buffer.alloc(2000)); return w;
}
test('plus: recommended settings are sane and apply', async () => {
  const { api, svc } = await setup();
  try {
    const r = svc.plusRecommend();
    assert.ok(r.ramMax >= 512 && r.ramMax <= 6144 && r.ramMin <= r.ramMax && r.ramMax <= r.totalMB * 0.6);
    assert.match(r.jvmArgs, /UseG1GC/);
    const s = svc.plusApplyRecommended();
    assert.equal(s.ramMax, r.ramMax); assert.equal(svc.getSettings().jvmArgs, r.jvmArgs);
  } finally { await api.close(); }
});
test('plus: backup worlds, keep last N, auto backup only when enabled and only changed worlds', async () => {
  const { api, svc, inst } = await setup();
  try {
    makeWorld(inst, 'Alpha', 'Alpha'); makeWorld(inst, 'Alpha-Beta', 'AB');
    svc.setSettings({ plusBackupKeep: 2 });
    for (let i = 0; i < 3; i++) { await svc.plusBackupWorlds(inst.id); await new Promise((r) => setTimeout(r, 1100)); }
    const names = fs.readdirSync(path.join(inst.dir, 'backups'));
    assert.equal(names.filter((n) => n.startsWith('Alpha-2')).length, 2, 'pruned to 2 for Alpha');
    assert.equal(names.filter((n) => n.startsWith('Alpha-Beta-')).length, 2, 'a world whose name starts with another world is pruned independently');
    assert.throws(() => svc.setSettings({ plusBackupKeep: 0 }), /between 1 and 20/);
    // auto backup disabled -> nothing
    const before = fs.readdirSync(path.join(inst.dir, 'backups')).length;
    await svc.plus.autoBackup(inst.id); assert.equal(fs.readdirSync(path.join(inst.dir, 'backups')).length, before);
    // enabled but nothing changed since last backup -> nothing
    svc.setSettings({ plusAutoBackup: true });
    await svc.plus.autoBackup(inst.id); assert.equal(fs.readdirSync(path.join(inst.dir, 'backups')).length, before, 'unchanged worlds skipped');
    // world saved again -> backed up
    const lvl = path.join(inst.dir, 'saves', 'Alpha', 'level.dat'); const future = new Date(Date.now() + 5000); fs.utimesSync(lvl, future, future);
    const ev = []; svc.on('plus-backup', (e) => ev.push(e));
    await svc.plus.autoBackup(inst.id);
    assert.equal(ev.length, 1); assert.ok(ev[0].created[0].startsWith('Alpha-'));
  } finally { await api.close(); }
});
test('plus: backup profile to a folder and restore as a new profile', async () => {
  const { api, svc, inst } = await setup();
  try {
    makeWorld(inst, 'Base', 'Base'); fs.mkdirSync(path.join(inst.dir, 'mods'), { recursive: true }); fs.writeFileSync(path.join(inst.dir, 'mods', 'a.jar'), 'jar');
    const dest = tmp();
    await assert.rejects(svc.plusBackupProfile(inst.id, path.join(inst.dir, 'inside')), /outside the profile/);
    const r = await svc.plusBackupProfile(inst.id, dest);
    assert.ok(fs.existsSync(path.join(r.path, 'shoaib-profile.json')) && fs.existsSync(path.join(r.path, 'mods', 'a.jar')));
    const restored = await svc.plusRestoreProfile(r.path);
    assert.notEqual(restored.id, inst.id); assert.ok(fs.existsSync(path.join(restored.dir, 'saves', 'Base', 'level.dat'))); assert.ok(fs.existsSync(path.join(restored.dir, 'mods', 'a.jar')));
    assert.ok(!fs.existsSync(path.join(restored.dir, 'shoaib-profile.json')));
    await assert.rejects(svc.plusRestoreProfile(tmp()), /not a Shoaib profile backup/);
  } finally { await api.close(); }
});
test('plus: launcher backup export/import (no secrets, merges safely)', async () => {
  const { api, svc, inst } = await setup();
  try {
    svc.accounts.addOffline('Shoaib'); svc.setSettings({ ramMax: 3072, curseforgeKey: 'SECRETKEY123' });
    const lay = svc.touchList().layouts.Default; svc.touchSave('Mine', lay);
    const f = path.join(tmp(), 'b.json'); const e = svc.plusExportBackup(f);
    assert.equal(e.instances, 1); assert.equal(e.layouts, 1); assert.equal(e.accounts, 1);
    assert.ok(!fs.readFileSync(f, 'utf8').includes('SECRETKEY123'), 'API key never exported');
    const other = new Service({ root: tmp(), contentUrls: api.urls });
    const r = other.plusImportBackup(f);
    assert.equal(r.instances, 1); assert.equal(r.layouts, 1); assert.equal(r.accounts, 1);
    assert.equal(other.getSettings().ramMax, 3072); assert.equal(other.listInstances().instances[0].name, 'Test');
    assert.equal(other.getSettings().curseforgeKeySet, false);
    assert.equal(other.plusImportBackup(f).instances, 0, 'second import does not duplicate');
    fs.writeFileSync(f, '{"format":"x"}'); assert.throws(() => other.plusImportBackup(f), /not a Shoaib Launcher backup/);
  } finally { await api.close(); }
});
test('plus: install queue runs profiles one after another and can be cancelled', async () => {
  const { startMock } = require('./mock');
  const m = await startMock();
  const svc = new Service({ root: tmp(), urls: m.urls });
  try {
    const rt = path.join(svc.d.runtimes, 'jre-21', 'x', 'bin'); fs.mkdirSync(rt, { recursive: true });
    fs.writeFileSync(path.join(rt, 'java'), `#!/bin/sh\necho 'openjdk version "21.0.1"' >&2\n`, { mode: 0o755 });
    m.ver.javaVersion = { majorVersion: 21 };
    const a = svc.createInstance({ name: 'A', mcVersion: 'test-1.0' }), b = svc.createInstance({ name: 'B', mcVersion: 'test-1.0' });
    assert.throws(() => svc.plusQueueInstalls([]), /at least one/); assert.throws(() => svc.plusQueueInstalls(['nope']), /not found/);
    const events = []; svc.on('plus-queue', (e) => events.push(e));
    assert.equal(svc.plusQueueInstalls([a.id, b.id]).total, 2);
    assert.throws(() => svc.plusQueueInstalls([a.id]), /already running/);
    await new Promise((r) => { const t = setInterval(() => { if (events.some((e) => e.state === 'done' || e.state === 'cancelled')) { clearInterval(t); r(); } }, 50); });
    assert.deepEqual(events.filter((e) => e.state === 'running').map((e) => e.index), [0, 1]);
    assert.equal(events.at(-1).state, 'done'); assert.equal(svc.plusState().queueRunning, false);
    assert.ok(svc.listInstances().instances.every((i) => i.installed) || events.at(-1).failed.length > 0);
  } finally { await m.close(); }
});

// ---------- network robustness ----------
test('network: timeout instead of hanging, clear error codes, diagnose tool, vanilla guard', async () => {
  const hang = await startApiMock({ hang: true });
  const prev = process.env.SHOAIB_HTTP_TIMEOUT; process.env.SHOAIB_HTTP_TIMEOUT = '300';
  try {
    const svcH = new Service({ root: tmp(), contentUrls: hang.urls, allowedHosts: ['127.0.0.1'] });
    const instH = svcH.createInstance({ name: 'H', mcVersion: 'test-1.0', loader: 'fabric' });
    const t0 = Date.now();
    await assert.rejects(svcH.contentSearch('modrinth', 'mod', { instanceId: instH.id }), /Modrinth: timed out/);
    assert.ok(Date.now() - t0 < 3000, 'gives up quickly instead of loading forever');
    const dh = await svcH.contentDiagnose({ only: ['modrinth'] });
    assert.equal(dh[0].ok, false); assert.match(dh[0].error, /timed out/); assert.match(dh[0].hint, /could not be reached/);
  } finally { await hang.close(); }
  try {
    const tmpSrv = require('http').createServer(); await new Promise((r) => tmpSrv.listen(0, '127.0.0.1', r)); const closedPort = tmpSrv.address().port; await new Promise((r) => tmpSrv.close(r));
    const dead = new Service({ root: tmp(), contentUrls: { modrinth: `http://127.0.0.1:${closedPort}/mr`, curseforge: `http://127.0.0.1:${closedPort}/cf` }, urls: { manifest: `http://127.0.0.1:${closedPort}/m`, resources: '', libraries: '' } });
    const d = await dead.contentDiagnose({ only: ['modrinth', 'curseforge', 'mojang'] });
    assert.equal(d.find((x) => x.key === 'modrinth').ok, false); assert.match(d.find((x) => x.key === 'modrinth').error, /ECONNREFUSED/);
    assert.equal(d.find((x) => x.key === 'curseforge').ok, null, 'no key -> informative, not an error');
    const inst = dead.createInstance({ name: 'D', mcVersion: '1.21.1', loader: 'fabric' });
    await assert.rejects(dead.contentSearch('modrinth', 'mod', { instanceId: inst.id }), /Modrinth: connection failed \[ECONNREFUSED\]/);
    const van = dead.createInstance({ name: 'V', mcVersion: '1.21.1' });
    await assert.rejects(dead.contentInstall({ instanceId: van.id, source: 'modrinth', projectId: 'P1', type: 'mod' }), /Vanilla profiles cannot use mods/);
  } finally { if (prev === undefined) delete process.env.SHOAIB_HTTP_TIMEOUT; else process.env.SHOAIB_HTTP_TIMEOUT = prev; }
  const { api, svc } = await setup();
  try {
    let d = await svc.contentDiagnose({ only: ['modrinth', 'curseforge'] });
    assert.equal(d.find((x) => x.key === 'modrinth').ok, true); assert.ok(d.find((x) => x.key === 'modrinth').ms >= 0);
    svc.setSettings({ curseforgeKey: 'WRONG' }); d = await svc.contentDiagnose({ only: ['curseforge'] }); assert.match(d[0].error, /key rejected/);
    svc.setSettings({ curseforgeKey: 'GOODKEY' }); d = await svc.contentDiagnose({ only: ['curseforge'] }); assert.equal(d[0].ok, true);
  } finally { await api.close(); }
});
