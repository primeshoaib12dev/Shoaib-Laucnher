'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMock } = require('./mock');
const { Service } = require('../src/service');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shoaib-svc-'));
function fakeJava(dir) {
  const f = path.join(dir, 'fakejava.sh');
  fs.writeFileSync(f, `#!/bin/sh\nif [ "$1" = "-version" ]; then echo 'openjdk version "21.0.1"' >&2; exit 0; fi\necho "GAME-START $@"\nexit 0\n`, { mode: 0o755 });
  return f;
}
const linuxOnly = process.platform === 'win32' ? { skip: 'sh fake java' } : {};

test('service: settings validation + persistence', () => {
  const root = tmp();
  const s = new Service({ root });
  assert.throws(() => s.setSettings({ ramMin: 4096, ramMax: 1024 }), /lower than minimum/);
  assert.throws(() => s.setSettings({ ramMax: 'abc' }), /Invalid/);
  s.setSettings({ ramMin: 1024, ramMax: 3072, fullscreen: true });
  assert.equal(new Service({ root }).getSettings().ramMax, 3072);
  assert.ok(new Service({ root }).setSettings({ ramMax: 999999 }).warnings.length > 0, 'unsafe RAM warns');
  assert.equal(new Service({ root }).resetSettings().ramMax, 2048);
});

test('service: instances CRUD, duplicate, delete', () => {
  const s = new Service({ root: tmp() });
  assert.throws(() => s.createInstance({ name: '', mcVersion: '1.21' }), /name/);
  assert.throws(() => s.createInstance({ name: 'x', mcVersion: '1.21', loader: 'forge' }), /not supported/);
  const a = s.createInstance({ name: 'My World', mcVersion: '1.21.1' });
  assert.equal(s.listInstances().selected, a.id);
  assert.equal(a.installed, false);
  fs.writeFileSync(path.join(a.dir, 'options.txt'), 'x');
  const b = s.duplicateInstance(a.id);
  assert.ok(fs.existsSync(path.join(b.dir, 'options.txt')), 'files copied, instances isolated');
  assert.notEqual(a.dir, b.dir);
  s.renameInstance(a.id, 'Renamed');
  s.updateInstance(a.id, { ramMax: 4096 });
  assert.equal(s.listInstances().instances.find((i) => i.id === a.id).ramMax, 4096);
  s.deleteInstance(a.id);
  assert.ok(!fs.existsSync(a.dir)); assert.ok(fs.existsSync(b.dir));
  assert.equal(s.listInstances().selected, b.id);
});

test('service: Fabric instance install + play end-to-end (mock)', linuxOnly, async () => {
  const m = await startMock();
  const root = tmp();
  try {
    const profile = { ...m.fabric, id: 'fabric-loader-0.15-test-1.0' };
    m.put('/fabric/versions/loader/test-1.0', Buffer.from(JSON.stringify([{ loader: { version: '0.15', stable: true } }])));
    m.put('/fabric/versions/loader/test-1.0/0.15/profile/json', Buffer.from(JSON.stringify(profile)));
    const s = new Service({ root, urls: m.urls, loaderUrls: { fabric: m.base + '/fabric' } });
    s.accounts.addOffline('Shoaib');
    await assert.rejects(s.play('nope'), /not found/);
    const inst = s.createInstance({ name: 'Fab', mcVersion: 'test-1.0', loader: 'fabric' });
    await assert.rejects(s.play(inst.id), /not installed/);
    const events = [];
    s.on('install-progress', (p) => events.push(p)); s.on('install-done', (e) => events.push(e));
    // skip Java download: fake java must be found -> put it in the runtimes dir layout
    const rt = path.join(s.d.runtimes, 'jre-21', 'x', 'bin'); fs.mkdirSync(rt, { recursive: true });
    fs.copyFileSync(fakeJava(tmp()), path.join(rt, 'java')); fs.chmodSync(path.join(rt, 'java'), 0o755);
    s.updateInstance(inst.id, { javaPath: path.join(rt, 'java') });
    const done = await s.installInstance(inst.id);
    assert.equal(done.installed, true);
    assert.equal(done.versionId, 'fabric-loader-0.15-test-1.0');
    assert.ok(events.some((e) => e.percent > 0) && events.at(-1).ok === true);
    assert.ok(fs.existsSync(path.join(s.d.libraries, 'net/fab/loader/0.15/loader-0.15.jar')));
    const logs = [];
    s.on('game-log', (l) => logs.push(l.text));
    const exited = new Promise((r) => s.on('game-exit', r));
    const r = await s.play(inst.id);
    assert.ok(Array.isArray(r.warnings));
    const ex = await exited;
    assert.equal(ex.code, 0); assert.equal(ex.crashed, false);
    assert.ok(logs.join('').includes('net.fabricmc.loader.Knot'), 'fabric main class launched');
    assert.ok(logs.join('').includes('-DFabricMarker=1'), 'loader jvm args merged');
    assert.equal(s.listInstances().instances[0].running, false);
    await assert.rejects(s.installInstance('missing'), /not found/);
  } finally { await m.close(); }
});

test('service: unsupported loader version gives clear error', async () => {
  const m = await startMock();
  try {
    m.put('/fabric/versions/loader/1.2.3', Buffer.from('[]'));
    const s = new Service({ root: tmp(), urls: m.urls, loaderUrls: { fabric: m.base + '/fabric' } });
    await assert.rejects(s.loaderVersions('fabric', '1.2.3'), /does not support Minecraft 1.2.3/);
  } finally { await m.close(); }
});
