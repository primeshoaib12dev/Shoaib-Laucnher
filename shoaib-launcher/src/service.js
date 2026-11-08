'use strict';
// UI-independent application service. Electron main.js (and tests) call this.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { EventEmitter } = require('events');
const { dirs, ensure, defaultRoot, readLocation, locationFile, isAndroid } = require('./core/paths');
const { Content } = require('./content');
const { Worlds } = require('./worlds');
const { Controls } = require('./controls');
const { Touch } = require('./touch');
const { Plus } = require('./plus');
const log = require('./core/logger');
const V = require('./core/versions');
const { installVersion } = require('./core/install');
const { DownloadQueue } = require('./core/download');
const { prepareLaunch, launch } = require('./core/launch');
const { AccountStore } = require('./core/accounts');
const java = require('./core/java');
const L = require('./core/loaders');

const DEFAULT_SETTINGS = { plusAutoBackup: false, plusBackupKeep: 5, curseforgeKey: '', ramMin: 512, ramMax: 2048, javaPath: '', jvmArgs: '', width: 0, height: 0, fullscreen: false, hideOnLaunch: false };

class Service extends EventEmitter {
  constructor({ root, urls, loaderUrls, contentUrls, allowedHosts } = {}) {
    super();
    // Custom storage location: game data goes there, but Java runtimes stay on internal storage (FAT/SD cards cannot execute files).
    const custom = !root && !process.env.SHOAIB_HOME && readLocation()?.root;
    this.d = dirs(root, custom ? { runtimes: path.join(defaultRoot(), 'runtimes') } : {});
    ensure(this.d.root, this.d.mc, this.d.instances);
    log.setLogDir(this.d.logs);
    this.urls = urls || V.URLS;
    this.loaderUrls = loaderUrls || L.LOADER_URLS;
    this.accounts = new AccountStore(this.d);
    this.settingsFile = path.join(this.d.root, 'settings.json');
    this.instFile = path.join(this.d.root, 'instances.json');
    this.settings = { ...DEFAULT_SETTINGS, ...this._readJson(this.settingsFile, {}) };
    this.data = this._readJson(this.instFile, { selected: null, instances: [] });
    this.queue = null;
    this.games = new Map();
    if (this.settings.curseforgeKey) log.addSecret(this.settings.curseforgeKey);
    this.content = new Content(this, { urls: contentUrls, allowedHosts });
    this.worlds = new Worlds(this);
    this.controls = new Controls(this);
    this.touch = new Touch(this);
    this.plus = new Plus(this);
  }
  _readJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
  _save() { fs.writeFileSync(this.instFile, JSON.stringify(this.data, null, 2)); }

  // ---- settings ----
  getSettings() { const { curseforgeKey, ...rest } = this.settings; return { ...rest, curseforgeKeySet: !!curseforgeKey, systemRamMB: Math.floor(os.totalmem() / 1048576), warnings: this._ramWarnings() }; }
  _ramWarnings() {
    const w = []; const total = Math.floor(os.totalmem() / 1048576);
    if (this.settings.ramMax > total * 0.8) w.push(`Max RAM is above 80% of your ${total} MB system memory. Lower it to avoid freezes.`);
    if (this.settings.ramMax < 1024) w.push('Under 1 GB may cause out-of-memory crashes.');
    return w;
  }
  setSettings(patch) {
    const s = { ...this.settings };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in patch) s[k] = patch[k];
    for (const k of ['ramMin', 'ramMax', 'width', 'height']) { s[k] = Math.round(Number(s[k])); if (!Number.isFinite(s[k]) || s[k] < 0) throw new Error(`Invalid value for ${k}`); }
    if (s.ramMax < s.ramMin) throw new Error('Maximum RAM cannot be lower than minimum RAM');
    s.fullscreen = !!s.fullscreen; s.hideOnLaunch = !!s.hideOnLaunch; s.plusAutoBackup = !!s.plusAutoBackup;
    s.plusBackupKeep = Math.round(Number(s.plusBackupKeep)); if (!(s.plusBackupKeep >= 1 && s.plusBackupKeep <= 20)) throw new Error('Keep between 1 and 20 backups per world');
    s.jvmArgs = String(s.jvmArgs || ''); s.javaPath = String(s.javaPath || '');
    if (patch.curseforgeKey === null) s.curseforgeKey = '';
    else if (typeof patch.curseforgeKey === 'string' && patch.curseforgeKey.trim()) { s.curseforgeKey = patch.curseforgeKey.trim(); log.addSecret(s.curseforgeKey); }
    else s.curseforgeKey = this.settings.curseforgeKey || '';
    this.settings = s;
    fs.writeFileSync(this.settingsFile, JSON.stringify(s, null, 2));
    return this.getSettings();
  }
  resetSettings() { this.settings = { ...DEFAULT_SETTINGS, curseforgeKey: this.settings.curseforgeKey || '' }; fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2)); return this.getSettings(); }

  // ---- versions / loaders / java ----
  listVersions(opts) { return V.listVersions(this.d, { ...opts, urls: this.urls }); }
  loaderVersions(loader, mc) { return L.loaderVersions(loader, mc, this.loaderUrls); }
  detectJava() { return java.detectJava(this.d); }

  _noop() {}

  // ---- platform / paths for non-desktop shells ----
  getPlatform() {
    const android = isAndroid();
    return { platform: process.platform, arch: process.arch, android, canPlay: !android, reason: android ? 'This device (Android/Termux) cannot run Minecraft\'s desktop libraries. You can download versions, mods and worlds here. To play, use a desktop PC or an Android launcher that ships its own runtime.' : '' };
  }
  instanceFolder(id, sub) {
    const base = this.instanceDir(id); const ok = ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'backups'].includes(sub);
    return ok ? path.join(base, sub) : base;
  }
  /** Where exported files go when the shell cannot show a save dialog (web mode). */
  exportPath(name) {
    const dir = path.join(this.d.root, 'exports'); fs.mkdirSync(dir, { recursive: true });
    const n = path.basename(String(name || 'export')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'export';
    return path.join(dir, n);
  }

  // ---- storage location ----
  getStorage() {
    let free = null; try { const st = fs.statfsSync(this.d.root); free = st.bavail * st.bsize; } catch { /* ignore */ }
    const loc = readLocation();
    return { root: this.d.root, defaultRoot: defaultRoot(), custom: path.resolve(this.d.root) !== path.resolve(defaultRoot()), runtimes: this.d.runtimes, freeBytes: free, envOverride: !!process.env.SHOAIB_HOME, savedRoot: loc?.root || null };
  }
  _dirSize(dir) { let n = 0; try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); n += e.isDirectory() ? this._dirSize(p) : fs.statSync(p).size; } } catch { /* ignore */ } return n; }
  /** Choose where game data lives (e.g. phone/SD/external storage). Takes effect after restart. */
  async setStorage(newRoot, { move = false } = {}) {
    if (this.games.size || this.queue) throw new Error('Close the game and finish installations first');
    if (!newRoot || !path.isAbsolute(newRoot)) throw new Error('Choose a full folder path');
    const target = path.resolve(newRoot); const cur = path.resolve(this.d.root);
    if (target === cur) throw new Error('This is already the current location');
    if (target.startsWith(cur + path.sep) || cur.startsWith(target + path.sep)) throw new Error('New location cannot be inside the current one (or contain it)');
    try { fs.mkdirSync(target, { recursive: true }); const t = path.join(target, `.shoaib-write-test-${process.pid}`); fs.writeFileSync(t, 'x'); fs.rmSync(t); }
    catch (e) { throw new Error(`Cannot write to that folder: ${e.message}`); }
    const NAMES = ['minecraft', 'instances', 'accounts.json', 'settings.json', 'instances.json', 'cache'];
    if (move) {
      for (const n of NAMES) if (fs.existsSync(path.join(target, n))) throw new Error(`Target folder already contains "${n}". Choose an empty folder.`);
      const need = NAMES.reduce((a, n) => { const p = path.join(cur, n); try { return a + (fs.statSync(p).isDirectory() ? this._dirSize(p) : fs.statSync(p).size); } catch { return a; } }, 0);
      const st = fs.statfsSync(target);
      if (st.bavail * st.bsize < need * 1.05 + 50 * 1048576) throw new Error(`Not enough free space at target: need about ${(need / 1048576).toFixed(0)} MB`);
      for (const n of NAMES) { const src = path.join(cur, n); if (fs.existsSync(src)) await fs.promises.cp(src, path.join(target, n), { recursive: true }); }
      for (const n of NAMES) { const a = path.join(cur, n), b = path.join(target, n); if (fs.existsSync(a) && this._dirSize(a) !== this._dirSize(b) && fs.statSync(a).isDirectory()) throw new Error('Copy verification failed, original data kept'); }
      for (const n of NAMES) fs.rmSync(path.join(cur, n), { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(locationFile()), { recursive: true });
    fs.writeFileSync(locationFile(), JSON.stringify({ root: target }));
    return { restartRequired: true, root: target, moved: !!move };
  }
  resetStorage() { fs.rmSync(locationFile(), { force: true }); return { restartRequired: true, root: defaultRoot() }; }

  // ---- accounts (offline now; Microsoft in M2) ----
  listAccounts() { return { accounts: this.accounts.list(), selected: this.accounts.data.selected }; }
  addOfflineAccount(name) { return this.accounts.addOffline(name); }
  renameAccount(id, name) { return this.accounts.rename(id, name); }
  removeAccount(id) { this.accounts.remove(id); return this.listAccounts(); }
  selectAccount(id) { this.accounts.select(id); return this.listAccounts(); }

  // ---- instances ----
  _status(i) { return { ...i, installed: V.isInstalled(this.d, i.versionId || i.mcVersion), running: this.games.has(i.id), dir: path.join(this.d.instances, i.id) }; }
  listInstances() { return { selected: this.data.selected, instances: this.data.instances.map((i) => this._status(i)) }; }
  _get(id) { const i = this.data.instances.find((x) => x.id === id); if (!i) throw new Error('Instance not found'); return i; }
  createInstance({ name, mcVersion, loader = 'vanilla', loaderVersion = '' }) {
    name = String(name || '').trim();
    if (!name || name.length > 40) throw new Error('Instance name must be 1-40 characters');
    if (!mcVersion) throw new Error('Choose a Minecraft version');
    if (!L.SUPPORTED.includes(loader)) throw new Error(`${loader} is not supported yet`);
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) + '-' + crypto.randomBytes(3).toString('hex');
    const inst = { id, name, mcVersion, loader, loaderVersion, versionId: loader === 'vanilla' ? mcVersion : null, ramMax: null, javaPath: '', createdAt: new Date().toISOString() };
    fs.mkdirSync(path.join(this.d.instances, id), { recursive: true });
    this.data.instances.push(inst);
    if (!this.data.selected) this.data.selected = id;
    this._save();
    return this._status(inst);
  }
  selectInstance(id) { this._get(id); this.data.selected = id; this._save(); return this.listInstances(); }
  renameInstance(id, name) { name = String(name || '').trim(); if (!name || name.length > 40) throw new Error('Instance name must be 1-40 characters'); this._get(id).name = name; this._save(); return this.listInstances(); }
  updateInstance(id, patch) {
    const i = this._get(id);
    if ('ramMax' in patch) { const r = patch.ramMax ? Math.round(Number(patch.ramMax)) : null; if (r !== null && (!(r >= 256))) throw new Error('RAM must be at least 256 MB'); i.ramMax = r; }
    if ('javaPath' in patch) i.javaPath = String(patch.javaPath || '');
    this._save(); return this._status(i);
  }
  duplicateInstance(id) {
    const src = this._get(id);
    const copy = this.createInstance({ name: (src.name + ' copy').slice(0, 40), mcVersion: src.mcVersion, loader: src.loader, loaderVersion: src.loaderVersion });
    const c = this._get(copy.id); c.versionId = src.versionId; c.ramMax = src.ramMax; c.javaPath = src.javaPath;
    fs.cpSync(path.join(this.d.instances, id), path.join(this.d.instances, copy.id), { recursive: true });
    this._save(); return this._status(c);
  }
  deleteInstance(id, { deleteFiles = true } = {}) {
    if (this.games.has(id)) throw new Error('Stop the game before deleting this instance');
    this._get(id);
    this.data.instances = this.data.instances.filter((i) => i.id !== id);
    if (this.data.selected === id) this.data.selected = this.data.instances[0]?.id || null;
    this._save();
    if (deleteFiles) fs.rmSync(path.join(this.d.instances, id), { recursive: true, force: true });
    return this.listInstances();
  }
  instanceDir(id) { this._get(id); return path.join(this.d.instances, id); }

  // ---- install ----
  async installInstance(id) {
    if (this.queue) throw new Error('Another installation is already running');
    const inst = this._get(id);
    const q = this.queue = new DownloadQueue();
    q.on('progress', (p) => this.emit('install-progress', { instanceId: id, ...p }));
    q.on('stage', (s) => this.emit('install-stage', { instanceId: id, stage: s }));
    q.on('state', (s) => this.emit('install-state', { instanceId: id, state: s }));
    try {
      this.emit('install-stage', { instanceId: id, stage: 'loader' });
      const versionId = await L.installLoaderProfile(this.d, inst.loader, inst.mcVersion, inst.loaderVersion, this.loaderUrls);
      inst.versionId = versionId; this._save();
      await installVersion(this.d, versionId, { queue: q, urls: this.urls, installJava: true });
      this.emit('install-done', { instanceId: id, ok: true });
      return this._status(inst);
    } catch (e) {
      const cancelled = e.name === 'CancelSignal';
      this.emit('install-done', { instanceId: id, ok: false, cancelled, error: cancelled ? 'Cancelled' : e.message });
      if (cancelled) return this._status(inst);
      throw e;
    } finally { this.queue = null; }
  }
  pauseInstall() { this.queue?.pause(); }
  resumeInstall() { this.queue?.resume(); }
  cancelInstall() { this.queue?.cancel(); }

  // ---- play ----
  async play(id) {
    const inst = this._get(id);
    if (this.games.has(id)) throw new Error('This instance is already running');
    const account = this.accounts.selected();
    if (!account) throw new Error('No account selected. Add an offline profile in Accounts.');
    const s = this.settings;
    const prep = await prepareLaunch({
      d: this.d, versionId: inst.versionId || inst.mcVersion, account, urls: this.urls,
      javaPath: inst.javaPath || s.javaPath || undefined, gameDir: path.join(this.d.instances, id),
      ramMin: Math.min(s.ramMin, inst.ramMax || s.ramMax), ramMax: inst.ramMax || s.ramMax,
      jvmArgs: s.jvmArgs.split(/\s+/).filter(Boolean), width: s.width || undefined, height: s.height || undefined, fullscreen: s.fullscreen,
    });
    const h = launch(prep, { onLog: (text, stream) => this.emit('game-log', { instanceId: id, text, stream }) });
    this.games.set(id, h);
    this.emit('game-state', { instanceId: id, running: true, warnings: prep.warnings });
    h.exit.then(async (r) => { this.games.delete(id); this.emit('game-state', { instanceId: id, running: false }); this.emit('game-exit', { instanceId: id, ...r }); await this.plus.autoBackup(id); });
    return { warnings: prep.warnings, logFile: h.logFile };
  }
  stop(id) { this.games.get(id)?.kill(); }
}
const cap = (x) => x[0].toUpperCase() + x.slice(1);
for (const m of ['diagnose', 'search', 'versions', 'install', 'installed', 'toggle', 'remove', 'importLocal', 'checkUpdates', 'updateItem', 'installModpack', 'importModpack', 'exportMrpack']) {
  Service.prototype['content' + cap(m)] = function (...a) { return this.content[m](...a); };
}
for (const [prop, names] of [['worlds', ['list', 'backup', 'delete', 'importZip']], ['controls', ['get', 'set', 'reset']], ['touch', ['list', 'save', 'delete', 'setActive']]]) {
  for (const m of names) Service.prototype[prop + cap(m)] = function (...a) { return this[prop][m](...a); };
}
for (const [n, m] of [['Recommend', 'recommend'], ['ApplyRecommended', 'applyRecommended'], ['BackupWorlds', 'backupWorlds'], ['BackupProfile', 'backupProfile'], ['RestoreProfile', 'restoreProfile'], ['ExportBackup', 'exportBackup'], ['ImportBackup', 'importBackup'], ['QueueInstalls', 'queueInstalls'], ['QueueCancel', 'cancelQueue'], ['State', 'state']]) {
  Service.prototype['plus' + n] = function (...a) { return this.plus[m](...a); };
}
module.exports = { Service, DEFAULT_SETTINGS };
