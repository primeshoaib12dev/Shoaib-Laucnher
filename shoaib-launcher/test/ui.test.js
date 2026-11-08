'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMock } = require('./mock');
const { startApiMock } = require('./apimock');
const { Service } = require('../src/service');
const { boot, wait, buttonByText, fire } = require('./fakedom');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shoaib-ui-'));
const inputs = (root) => root.find((e) => e.tag === 'input');
const selects = (root) => root.find((e) => e.tag === 'select');

test('journey: add account -> create profile -> DOWNLOAD -> PLAY (full first-run flow)', async () => {
  const m = await startMock();
  const svc = new Service({ root: tmp(), urls: m.urls });
  m.ver.javaVersion = { majorVersion: 21 };
  // fake java so the test does not depend on the machine's Java
  const rt = path.join(svc.d.runtimes, 'jre-21', 'x', 'bin'); fs.mkdirSync(rt, { recursive: true });
  fs.writeFileSync(path.join(rt, 'java'), `#!/bin/sh\nif [ "$1" = "-version" ]; then echo 'openjdk version "21.0.1"' >&2; exit 0; fi\necho "GAME-RUNNING $@"\nexit 0\n`, { mode: 0o755 });
  const ui = boot(svc);
  try {
    await wait(150);
    assert.match(ui.view().textContent, /Welcome to Shoaib Launcher|latest release/);
    assert.match(ui.view().textContent, /Create profile/, 'no profile yet');
    assert.match(ui.top().textContent, /Shoaib Launcher/); assert.match(ui.top().textContent, /No account/);

    // add account from the top-right chip
    El_click(ui.top().find((e) => e.className === 'chip-acc')[0]); await wait(50);
    El_click(ui.pop().find((e) => e.className === 'item')[0]); await wait(50);
    inputs(ui.modal())[0].value = 'ab'; buttonByText(ui.modal(), 'Add').click(); await wait(100);
    assert.match(ui.toasts(), /3-16/, 'bad name rejected');
    inputs(ui.modal())[0].value = 'Shoaib'; buttonByText(ui.modal(), 'Add').click(); await wait(150);
    assert.match(ui.top().textContent, /Shoaib/); assert.match(ui.top().textContent, /Local account/);

    // Versions -> Create new profile (versions come from the Mojang-style manifest)
    El_click(ui.view().find((e) => e.className === 'versions-btn')[0]); await wait(100);
    assert.match(ui.view().textContent, /Create new profile/);
    El_click(ui.view().find((e) => e.className === 'card' && e.textContent === 'Create new profile')[0]); await wait(250);
    const sel = selects(ui.modal());
    assert.ok(sel[1].options.some((o) => o.textContent.startsWith('test-1.0')), 'version list loaded from manifest');
    sel[1].value = 'test-1.0'; sel[2].value = 'vanilla';
    buttonByText(ui.modal(), 'Create').click(); await wait(300);
    assert.match(ui.view().textContent, /Download/); assert.match(ui.view().textContent, /Version test-1\.0/);
    assert.ok(!buttonByText(ui.view(), 'Play'), 'cannot play before downloading');
    const playMain = ui.view().find((e) => e.className === 'main')[0];
    assert.match(playMain.textContent, /Download/);

    // Download -> real install against mock server
    playMain.click(); await wait(2500);
    assert.match(ui.toasts(), /Download complete/);
    assert.ok(require('../src/core/versions').isInstalled(svc.d, 'test-1.0'));
    const main2 = ui.view().find((e) => e.className === 'main')[0];
    assert.match(main2.textContent, /Play/);

    // Play (use the fake java so the test is machine independent)
    svc.updateInstance(svc.listInstances().selected, { javaPath: path.join(rt, 'java') });
    const exited = new Promise((r) => svc.on('game-exit', r));
    main2.click(); await wait(200);
    const ex = await exited; await wait(100);
    assert.equal(ex.code, 0);
    assert.match(ui.toasts(), /Game closed/);
    assert.match(fs.readFileSync(ex.logFile, 'utf8'), /GAME-RUNNING/);
  } finally { await m.close(); }
});
function El_click(el) { (el.listeners.click || []).forEach((f) => f({ target: el })); }

test('screens: Library, Browse install, Worlds, Controls, touch editor, Settings', async () => {
  const api = await startApiMock();
  const svc = new Service({ root: tmp(), contentUrls: api.urls, allowedHosts: ['127.0.0.1'] });
  svc.accounts.addOffline('Shoaib');
  const inst = svc.createInstance({ name: 'Fab', mcVersion: 'test-1.0', loader: 'fabric' });
  fs.mkdirSync(path.join(inst.dir, 'saves', 'W1'), { recursive: true });
  fs.writeFileSync(path.join(inst.dir, 'saves', 'W1', 'level.dat'), require('zlib').gzipSync(Buffer.from([10, 0, 0, 0])));
  const ui = boot(svc);
  try {
    await wait(150);
    assert.match(ui.view().textContent, /Game RAM/); assert.match(ui.view().textContent, /Free space/); assert.ok(ui.view().find((e) => e.className === 'plusbtn').length, 'Shoaib+ chip on Home');
    ui.tap('Library'); await wait(250);
    assert.match(ui.view().textContent, /Import modpack/); assert.match(ui.view().textContent, /Browse mods/); assert.match(ui.view().textContent, /Browse resource packs/); assert.match(ui.view().textContent, /Browse shaders/); assert.match(ui.view().textContent, /Installed content/);
    assert.match(ui.top().textContent, /Library/);
    const tile = (t) => ui.view().find((e) => e.className.startsWith('tile') && e.textContent.startsWith(t))[0];
    El_click(tile('Browse mods')); await wait(350);
    assert.match(ui.view().textContent, /Sodium/); assert.match(ui.view().textContent, /Recommended/); assert.match(ui.view().textContent, /CurseForge/);
    buttonByText(ui.view(), 'Install').click(); await wait(700);
    assert.ok(fs.existsSync(path.join(inst.dir, 'mods', 'sodium-1.0.jar')), 'Install button downloaded the mod into mods/');
    assert.match(ui.toasts(), /Installed: .*Sodium/);
    buttonByText(ui.view(), '● CurseForge').click(); await wait(300);
    assert.match(ui.view().textContent, /API key/);

    ui.tap('Back'); await wait(350);
    assert.match(ui.view().textContent, /Sodium/); assert.match(ui.view().textContent, /Fabric API/); assert.match(ui.view().textContent, /Active/);
    buttonByText(ui.view(), 'Disable').click(); await wait(250);
    assert.ok(fs.existsSync(path.join(inst.dir, 'mods', 'fabric-api-1.jar.disabled')));
    buttonByText(ui.view(), 'Check mod updates').click(); await wait(300);
    assert.match(ui.toasts(), /update/i);

    ui.tap('Home'); await wait(150);
    ui.tap('Worlds'); await wait(250);
    assert.match(ui.view().textContent, /W1/);
    buttonByText(ui.view(), 'Backup').click(); await wait(300);
    assert.equal(svc.worldsList(inst.id).backups.length, 1);

    ui.tap('Home'); await wait(100);
    ui.tap('Controls'); await wait(250);
    assert.match(ui.view().textContent, /Active touch layout: Default/); assert.match(ui.view().textContent, /Touch layout/); assert.match(ui.view().textContent, /Keyboard & mouse/);
    buttonByText(ui.view(), 'Edit').click(); await wait(250);
    assert.match(ui.view().textContent, /Select a button/); 
    const canvas = ui.view().find((e) => e.className === 'canvas')[0];
    assert.ok(canvas.children.length >= 10, 'default layout buttons drawn'); assert.ok(canvas.textContent.includes('JUMP'));
    const add = selects(ui.view()).find((s) => s.options.some((o) => o.textContent === '+ Add button…'));
    add.value = 'key.keyboard.q'; fire(add, 'change'); await wait(50);
    assert.equal(canvas.children.length, 16, 'added one button to the 15 default ones'); assert.ok(canvas.textContent.includes('DROP'));
    inputs(ui.view()).find((i) => i.value === 'My layout').value = 'Pro';
    buttonByText(ui.view(), 'Save').click(); await wait(250);
    assert.ok(svc.touchList().names.includes('Pro')); assert.ok(svc.touchList().layouts.Pro.buttons.some((b) => b.key === 'key.keyboard.q'));
    buttonByText(ui.view(), 'Set active').click(); await wait(250);
    assert.equal(svc.touchList().active, 'Pro');

    ui.tap('Home'); await wait(100);
    ui.tap('Settings'); await wait(200);
    for (const t of ['Shoaib\\+', 'Video and renderer', 'Performance', 'Control customization', 'Java runtimes', 'Storage', 'CurseForge', 'About']) assert.match(ui.view().textContent, new RegExp(t));
    // Shoaib+ page
    El_click(ui.view().find((e) => e.className.startsWith('srow') && /^Shoaib\+/.test(e.textContent))[0]); await wait(300);
    for (const t of ['Auto world backups', 'Smart settings', 'Download queue', 'Backup to folder', 'Launcher backup file', 'Cloud sync', 'Not available']) assert.match(ui.view().textContent, new RegExp(t));
    assert.match(ui.top().textContent, /Shoaib\+/);
    buttonByText(ui.view(), 'Back up all worlds now').click(); await wait(500);
    assert.equal(svc.worldsList(inst.id).backups.length >= 1, true, 'Plus backup button copied the world');
    const rec = svc.plusRecommend(); buttonByText(ui.view(), 'Apply').click(); await wait(250);
    assert.equal(svc.getSettings().ramMax, rec.ramMax);
    const autoBox = inputs(ui.view()).find((i) => i.attrs.type === 'checkbox'); autoBox.checked = true; buttonByText(ui.view(), 'Save').click(); await wait(250);
    assert.equal(svc.getSettings().plusAutoBackup, true);
    ui.tap('Back'); await wait(200);
    El_click(ui.view().find((e) => e.className === 'srow' && /^Storage/.test(e.textContent))[0]); await wait(250);
    assert.match(ui.view().textContent, /Java runtimes always stay on internal storage/);
    ui.tap('Back'); await wait(150);
    El_click(ui.view().find((e) => e.className === 'srow' && /^Network check/.test(e.textContent))[0]); await wait(1500);
    assert.match(ui.view().textContent, /Modrinth/); assert.match(ui.view().textContent, /Reachable/); assert.match(ui.view().textContent, /Mojang versions/);
    ui.tap('Back'); await wait(150);
    El_click(ui.view().find((e) => e.className === 'srow' && /^Performance/.test(e.textContent))[0]); await wait(200);
    inputs(ui.view())[1].value = '3072'; buttonByText(ui.view(), 'Save').click(); await wait(200);
    assert.equal(svc.getSettings().ramMax, 3072);
  } finally { await api.close(); }
});
