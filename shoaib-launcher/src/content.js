'use strict';
// Mods / modpacks / resource packs / shaders: search, install (with dependencies + hash verification),
// library management, updates, .mrpack / CurseForge modpack import, .mrpack export.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Modrinth, CurseForge, UA, describeNetError, netHint, timeoutMs } = require('./core/providers');
const { downloadFile, DownloadQueue, hashFile } = require('./core/download');
const { readEntry, extractZip, writeZip } = require('./core/zip');
const log = require('./core/logger');

const DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const EXT = { mod: ['.jar'], resourcepack: ['.zip'], shader: ['.zip'] };
const HOSTS = ['cdn.modrinth.com', 'edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];

function safeName(n) {
  const b = path.basename(String(n || '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 150).trim();
  if (!b || b === '.' || b === '..') throw new Error('Unsafe file name received from provider');
  return b;
}
function inside(root, p) { const r = path.resolve(root); const x = path.resolve(r, p); return x === r || x.startsWith(r + path.sep) ? x : null; }

class Content {
  constructor(svc, { urls = {}, allowedHosts = [] } = {}) {
    this.svc = svc;
    this.extraHosts = new Set(allowedHosts);
    this.providers = { modrinth: new Modrinth(urls.modrinth), curseforge: new CurseForge(() => svc.settings.curseforgeKey, urls.curseforge) };
  }
  p(source) { const x = this.providers[source]; if (!x) throw new Error(`Unknown source ${source}`); return x; }
  allowed(u) {
    let url; try { url = new URL(u); } catch { return false; }
    if (this.extraHosts.has(url.hostname)) return true;
    return url.protocol === 'https:' && (HOSTS.includes(url.hostname) || url.hostname.endsWith('.forgecdn.net'));
  }
  _inst(id) { return this.svc._get(id); }
  _idir(inst) { return path.join(this.svc.d.instances, inst.id); }
  _dir(inst, type) { if (!DIRS[type]) throw new Error(`Unknown content type ${type}`); return path.join(this._idir(inst), DIRS[type]); }
  _metaFile(inst) { return path.join(this._idir(inst), 'shoaib-content.json'); }
  _load(inst) { try { return JSON.parse(fs.readFileSync(this._metaFile(inst), 'utf8')); } catch { return { items: [], missing: [] }; } }
  _save(inst, m) { fs.mkdirSync(this._idir(inst), { recursive: true }); fs.writeFileSync(this._metaFile(inst), JSON.stringify(m, null, 2)); }
  _ctx(instanceId, anyVersion) { if (!instanceId) return {}; const i = this._inst(instanceId); return anyVersion ? { inst: i } : { inst: i, mc: i.mcVersion, loader: i.loader }; }

  // ---------- browse ----------
  search(source, type, opts = {}) { const c = this._ctx(opts.instanceId, opts.anyVersion || type === 'modpack'); return this.p(source).search(type, { query: opts.query, sort: opts.sort, offset: opts.offset, mc: c.mc, loader: c.loader }); }
  async versions(source, projectId, type, instanceId) {
    const c = this._ctx(instanceId, type === 'modpack');
    const list = await this.p(source).versions(projectId, { mc: c.mc, loader: c.loader, type });
    return list.sort((a, b) => String(b.datePublished).localeCompare(String(a.datePublished)));
  }

  /** Connectivity test for every online service the launcher uses. Never throws. */
  async diagnose({ only } = {}) {
    const svc = this.svc; const want = (k) => !only || only.includes(k); const out = [];
    const probe = async (key, name, url, headers = {}) => {
      if (!want(key)) return;
      const t0 = Date.now();
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(Math.min(timeoutMs(), 10000)) });
        const ms = Date.now() - t0;
        if (res.status === 401 || res.status === 403) out.push({ key, name, ok: false, ms, status: res.status, error: `API key rejected (HTTP ${res.status})`, hint: 'Paste a valid key in Settings → CurseForge.' });
        else if (!res.ok) out.push({ key, name, ok: false, ms, status: res.status, error: `HTTP ${res.status}`, hint: '' });
        else out.push({ key, name, ok: true, ms, status: res.status });
      } catch (e) { const msg = describeNetError(e); out.push({ key, name, ok: false, ms: Date.now() - t0, error: msg, hint: netHint(msg) }); }
    };
    await probe('modrinth', 'Modrinth', `${this.providers.modrinth.base}/search?limit=1`);
    if (want('curseforge')) {
      const key = svc.settings.curseforgeKey;
      if (!key) out.push({ key: 'curseforge', name: 'CurseForge', ok: null, note: 'No API key set (needed for CurseForge only).' });
      else await probe('curseforge', 'CurseForge', `${this.providers.curseforge.base}/v1/games/432`, { 'x-api-key': key, Accept: 'application/json' });
    }
    await probe('mojang', 'Mojang versions', svc.urls.manifest);
    if (want('java')) await probe('java', 'Java downloads (Adoptium)', 'https://api.adoptium.net/v3/info/available_releases');
    return out;
  }

  // ---------- install ----------
  async install({ instanceId, source, projectId, versionId, type = 'mod' }) {
    if (type === 'modpack') throw new Error('Use installModpack for modpacks');
    const inst = this._inst(instanceId);
    if (type === 'mod' && inst.loader === 'vanilla') throw new Error('Vanilla profiles cannot use mods. Create a Fabric or Quilt profile (Versions → Create new profile).');
    const state = { installed: [], restricted: [], missing: [], seen: new Set() };
    await this._installProject(inst, source, projectId, versionId, type, state, 0);
    delete state.seen;
    return state;
  }
  async _pick(prov, source, projectId, versionId, type, inst) {
    if (versionId) return prov.version(versionId, projectId);
    const list = (await prov.versions(projectId, { mc: inst.mcVersion, loader: inst.loader, type })).sort((a, b) => String(b.datePublished).localeCompare(String(a.datePublished)));
    return list[0] || null;
  }
  async _installProject(inst, source, projectId, versionId, type, st, depth) {
    if (depth > 5) return;
    const prov = this.p(source);
    if (!projectId && versionId) projectId = (await prov.version(versionId)).projectId;
    const key = `${source}:${projectId}`;
    if (st.seen.has(key)) return; st.seen.add(key);
    const meta = this._load(inst);
    const dir = this._dir(inst, type);
    if (!versionId && meta.items.some((i) => i.source === source && i.projectId === projectId && i.type === type && (fs.existsSync(path.join(dir, i.filename)) || fs.existsSync(path.join(dir, i.filename + '.disabled'))))) return;
    const v = await this._pick(prov, source, projectId, versionId, type, inst);
    if (!v) {
      if (depth === 0) throw new Error(`No ${type} version found for Minecraft ${inst.mcVersion}${type === 'mod' ? ' on ' + inst.loader : ''}. Try another version or loader.`);
      st.missing.push(projectId); return;
    }
    let title = projectId, iconUrl = '';
    try { const pr = await prov.project(projectId); title = pr.title; iconUrl = pr.iconUrl; } catch { /* optional */ }
    if (v.restricted || !v.file) { st.restricted.push({ title, webUrl: v.webUrl || '' }); return; }
    const item = await this._download(inst, type, source, v, title, iconUrl);
    st.installed.push({ title, filename: item.filename, type });
    for (const d of v.deps) if (d.type === 'required') await this._installProject(inst, source, d.projectId, d.versionId, 'mod', st, depth + 1);
  }
  async _download(inst, type, source, v, title, iconUrl, replace) {
    if (!this.allowed(v.file.url)) throw new Error(`Blocked download from untrusted host: ${new URL(v.file.url).hostname}`);
    const filename = safeName(v.file.filename);
    if (!EXT[type].includes(path.extname(filename).toLowerCase())) throw new Error(`Unexpected file type "${filename}" for ${type}`);
    const dir = this._dir(inst, type);
    const dest = inside(dir, filename); if (!dest) throw new Error('Unsafe destination path');
    let got = 0;
    await downloadFile({ url: v.file.url, dest, sha1: v.file.sha1, sha512: v.file.sha512, size: v.file.size, onBytes: (n, r) => { got += n + r; this.svc.emit('content-progress', { name: filename, doneBytes: got, size: v.file.size || 0 }); } });
    const sha1 = v.file.sha1 || await hashFile(dest, 'sha1');
    const sha512 = v.file.sha512 || await hashFile(dest, 'sha512');
    const meta = this._load(inst);
    meta.items = meta.items.filter((i) => !(i.type === type && (i.filename === filename || (replace && i.filename === replace.filename))));
    if (replace && replace.filename !== filename) for (const n of [replace.filename, replace.filename + '.disabled']) fs.rmSync(path.join(dir, n), { force: true });
    const item = { type, source, projectId: v.projectId, versionId: v.id, title, iconUrl, filename, url: v.file.url, sha1, sha512, size: v.file.size || fs.statSync(dest).size, installedAt: new Date().toISOString() };
    meta.items.push(item); this._save(inst, meta);
    return item;
  }

  // ---------- library ----------
  installed(instanceId) {
    const inst = this._inst(instanceId); const meta = this._load(inst); const out = { mod: [], resourcepack: [], shader: [] };
    for (const type of Object.keys(DIRS)) {
      const dir = this._dir(inst, type);
      let names = []; try { names = fs.readdirSync(dir); } catch { /* none */ }
      for (const name of names) {
        const base = name.replace(/\.disabled$/, '');
        let st; try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
        if (!st.isDirectory() && !EXT[type].includes(path.extname(base).toLowerCase())) continue;
        if (st.isDirectory() && type === 'mod') continue;
        const m = meta.items.find((i) => i.type === type && i.filename === base);
        out[type].push({ filename: name, base, enabled: !name.endsWith('.disabled'), title: m?.title || base, source: m?.source || 'local', projectId: m?.projectId || null, versionId: m?.versionId || null, iconUrl: m?.iconUrl || '', size: st.isDirectory() ? 0 : st.size });
      }
      out[type].sort((a, b) => a.title.localeCompare(b.title));
    }
    out.missing = meta.missing || [];
    return out;
  }
  _existing(inst, type, filename) {
    const name = safeName(filename); const f = inside(this._dir(inst, type), name);
    if (!f || !fs.existsSync(f)) throw new Error('File not found in this instance');
    return { f, name, dir: this._dir(inst, type) };
  }
  toggle(instanceId, type, filename) {
    const inst = this._inst(instanceId); const { f, name } = this._existing(inst, type, filename);
    const to = name.endsWith('.disabled') ? f.slice(0, -'.disabled'.length) : f + '.disabled';
    if (fs.existsSync(to)) throw new Error('A file with the target name already exists');
    fs.renameSync(f, to); return { enabled: !to.endsWith('.disabled') };
  }
  remove(instanceId, type, filename) {
    const inst = this._inst(instanceId); const { f, name } = this._existing(inst, type, filename);
    fs.rmSync(f, { recursive: true, force: true });
    const base = name.replace(/\.disabled$/, ''); const meta = this._load(inst);
    meta.items = meta.items.filter((i) => !(i.type === type && i.filename === base)); this._save(inst, meta);
    return this.installed(instanceId);
  }
  async importLocal(instanceId, type, src) {
    const inst = this._inst(instanceId);
    const name = safeName(src);
    if (!EXT[type].includes(path.extname(name).toLowerCase())) throw new Error(`Only ${EXT[type].join('/')} files can be imported as ${type}`);
    if (!fs.statSync(src).isFile()) throw new Error('Not a file');
    const dir = this._dir(inst, type); fs.mkdirSync(dir, { recursive: true });
    let dest = inside(dir, name), n = 1;
    while (fs.existsSync(dest) || fs.existsSync(dest + '.disabled')) dest = inside(dir, name.replace(/(\.[^.]+)$/, `-${++n}$1`));
    fs.copyFileSync(src, dest);
    const sha1 = await hashFile(dest, 'sha1');
    const meta = this._load(inst); const filename = path.basename(dest);
    const item = { type, source: 'local', projectId: null, versionId: null, title: filename, iconUrl: '', filename, sha1, size: fs.statSync(dest).size, installedAt: new Date().toISOString() };
    try { // best effort: recognise it on Modrinth by hash
      const found = (await this.providers.modrinth.identify([sha1]))[sha1];
      if (found) { Object.assign(item, { source: 'modrinth', projectId: found.projectId, versionId: found.id, url: found.file?.url, sha512: found.file?.sha512 }); try { const pr = await this.providers.modrinth.project(found.projectId); item.title = pr.title; item.iconUrl = pr.iconUrl; } catch { /* optional */ } }
    } catch (e) { log.warn('identify failed: ' + e.message); }
    meta.items.push(item); this._save(inst, meta);
    return item;
  }
  async checkUpdates(instanceId) {
    const inst = this._inst(instanceId); const meta = this._load(inst);
    const tracked = meta.items.filter((i) => i.source === 'modrinth' && i.sha1);
    if (!tracked.length) return [];
    const res = await this.providers.modrinth.latestFor(tracked.map((i) => i.sha1), { mc: inst.mcVersion, loader: inst.loader });
    const out = [];
    for (const i of tracked) { const v = res[i.sha1]; if (v && v.id !== i.versionId && v.file?.sha1 !== i.sha1) out.push({ type: i.type, filename: i.filename, title: i.title, current: i.versionId, latestId: v.id, latest: v.number }); }
    return out;
  }
  async updateItem(instanceId, type, base) {
    const inst = this._inst(instanceId); const meta = this._load(inst);
    const item = meta.items.find((i) => i.type === type && i.filename === base && i.source === 'modrinth');
    if (!item) throw new Error('This file is not tracked, cannot update');
    const res = await this.providers.modrinth.latestFor([item.sha1], { mc: inst.mcVersion, loader: inst.loader });
    const v = res[item.sha1]; if (!v || !v.file) throw new Error('No newer compatible version found');
    const wasDisabled = fs.existsSync(path.join(this._dir(inst, type), base + '.disabled'));
    const ni = await this._download(inst, type, 'modrinth', v, item.title, item.iconUrl, item);
    if (wasDisabled) this.toggle(instanceId, type, ni.filename);
    return ni;
  }

  // ---------- modpacks ----------
  async installModpack({ source, projectId, versionId }) {
    const prov = this.p(source);
    const v = versionId ? await prov.version(versionId, projectId) : (await this.versions(source, projectId, 'modpack'))[0];
    if (!v) throw new Error('No modpack version found');
    if (v.restricted || !v.file) throw new Error(`The author of this modpack does not allow third-party launchers to download it. Download it manually${v.webUrl ? ' from ' + v.webUrl : ''}, then use "Import modpack file".`);
    if (!this.allowed(v.file.url)) throw new Error('Blocked download from untrusted host');
    const dest = inside(path.join(this.svc.d.cache, 'modpacks'), safeName(v.file.filename));
    if (!/\.(mrpack|zip)$/i.test(dest)) throw new Error('Unexpected modpack file type');
    await downloadFile({ url: v.file.url, dest, sha1: v.file.sha1, sha512: v.file.sha512, size: v.file.size });
    return this.importModpack(dest);
  }
  async importModpack(file) {
    if (this.svc.queue) throw new Error('Another installation is already running');
    const mr = readEntry(file, 'modrinth.index.json');
    if (mr) return this._importMrpack(file, JSON.parse(mr.toString('utf8')));
    const cf = readEntry(file, 'manifest.json');
    if (cf) return this._importCurseforge(file, JSON.parse(cf.toString('utf8')));
    throw new Error('Not a supported modpack (no modrinth.index.json or manifest.json found)');
  }
  _loaderFromDeps(deps) {
    for (const k of Object.keys(deps)) if (k === 'forge' || k === 'neoforge') throw new Error(`This modpack needs ${k}, which is not supported yet (Fabric, Quilt and Vanilla packs work).`);
    if (deps['fabric-loader']) return ['fabric', deps['fabric-loader']];
    if (deps['quilt-loader']) return ['quilt', deps['quilt-loader']];
    return ['vanilla', ''];
  }
  async _runFiles(inst, tasks, file, overridesDirs) {
    const q = this.svc.queue = new DownloadQueue();
    q.on('progress', (p) => this.svc.emit('install-progress', { instanceId: inst.id, ...p, stage: 'modpack' }));
    this.svc.emit('install-stage', { instanceId: inst.id, stage: 'modpack' });
    try {
      const r = await q.run(tasks, 'modpack');
      if (r.failed.length) throw new Error(`${r.failed.length} modpack files failed: ${r.failed.slice(0, 3).map((f) => f.task.name + ' (' + f.error + ')').join('; ')}`);
      const idir = this._idir(inst);
      extractZip(file, idir, { filter: (n) => { for (const d of overridesDirs) if (n.startsWith(d + '/') && n.length > d.length + 1) return n.slice(d.length + 1); return false; } });
    } finally { this.svc.queue = null; }
  }
  _track(inst, rels, source = 'modpack') {
    const meta = this._load(inst);
    for (const rel of rels) {
      const [folder, ...rest] = rel.split('/'); const type = Object.keys(DIRS).find((t) => DIRS[t] === folder); if (!type || rest.length !== 1) continue;
      meta.items.push({ type, source, projectId: null, versionId: null, title: rest[0], iconUrl: '', filename: rest[0], size: 0 });
    }
    this._save(inst, meta);
  }
  async _importMrpack(file, idx) {
    if (idx.formatVersion !== 1 || idx.game !== 'minecraft') throw new Error('Unsupported .mrpack format');
    const deps = idx.dependencies || {}; const mc = deps.minecraft; if (!mc) throw new Error('Modpack does not specify a Minecraft version');
    const [loader, loaderVersion] = this._loaderFromDeps(deps);
    const files = (idx.files || []).filter((f) => f.env?.client !== 'unsupported');
    const inst0 = this.svc.createInstance({ name: String(idx.name || 'Modpack').slice(0, 40), mcVersion: mc, loader, loaderVersion });
    const inst = this._inst(inst0.id); const idir = this._idir(inst);
    try {
      const tasks = [];
      for (const f of files) {
        const dest = inside(idir, f.path || '');
        if (!dest || path.isAbsolute(f.path) || !f.hashes?.sha1) throw new Error(`Modpack contains an unsafe or unverifiable file entry: ${f.path}`);
        const url = (f.downloads || []).find((u) => this.allowed(u));
        if (!url) throw new Error(`No trusted download source for ${f.path}`);
        tasks.push({ name: path.basename(f.path), url, dest, sha1: f.hashes.sha1, sha512: f.hashes.sha512, size: f.fileSize });
      }
      await this._runFiles(inst, tasks, file, ['overrides', 'client-overrides']);
      this._track(inst, files.map((f) => f.path.replace(/\\/g, '/')));
    } catch (e) { this.svc.deleteInstance(inst.id); throw e; }
    return { instance: this.svc._status(inst), missing: [] };
  }
  async _importCurseforge(file, man) {
    const prov = this.p('curseforge');
    const mc = man.minecraft?.version; if (!mc) throw new Error('Manifest has no Minecraft version');
    const ml = (man.minecraft.modLoaders || []).find((x) => x.primary) || man.minecraft.modLoaders?.[0];
    const [lname, ...lv] = String(ml?.id || '').split('-');
    if (lname === 'forge' || lname === 'neoforge') throw new Error(`This modpack needs ${lname}, which is not supported yet (Fabric, Quilt and Vanilla packs work).`);
    const loader = lname === 'fabric' || lname === 'quilt' ? lname : 'vanilla';
    const refs = man.files || [];
    const versions = refs.length ? await prov.filesByIds(refs.map((f) => f.fileID)) : [];
    const inst0 = this.svc.createInstance({ name: String(man.name || 'Modpack').slice(0, 40), mcVersion: mc, loader, loaderVersion: loader === 'vanilla' ? '' : lv.join('-') });
    const inst = this._inst(inst0.id); const idir = this._idir(inst);
    const missing = []; const tasks = []; const rels = [];
    try {
      for (const v of versions) {
        if (v.restricted || !v.file) { missing.push({ projectId: v.projectId, fileId: v.id, name: v.name, webUrl: `https://www.curseforge.com/projects/${v.projectId}` }); continue; }
        if (!this.allowed(v.file.url)) throw new Error('Blocked download from untrusted host');
        const name = safeName(v.file.filename); const ext = path.extname(name).toLowerCase();
        const folder = ext === '.jar' ? 'mods' : ext === '.zip' ? 'resourcepacks' : null; if (!folder) continue;
        tasks.push({ name, url: v.file.url, dest: inside(path.join(idir, folder), name), sha1: v.file.sha1, size: v.file.size }); rels.push(`${folder}/${name}`);
      }
      await this._runFiles(inst, tasks, file, [man.overrides || 'overrides']);
      this._track(inst, rels);
      const meta = this._load(inst); meta.missing = missing; this._save(inst, meta);
    } catch (e) { this.svc.deleteInstance(inst.id); throw e; }
    return { instance: this.svc._status(inst), missing };
  }
  exportMrpack(instanceId, dest) {
    const inst = this._inst(instanceId); const meta = this._load(inst); const idir = this._idir(inst);
    const files = []; const listed = new Set();
    for (const i of meta.items) {
      const rel = `${DIRS[i.type]}/${i.filename}`;
      if (i.source === 'modrinth' && i.sha1 && i.sha512 && i.url && fs.existsSync(path.join(idir, rel))) { files.push({ path: rel, hashes: { sha1: i.sha1, sha512: i.sha512 }, env: { client: 'required', server: 'required' }, downloads: [i.url], fileSize: i.size }); listed.add(rel); }
    }
    const entries = []; const skipTop = new Set(['saves', 'logs', 'crash-reports', 'screenshots', 'shoaib-content.json', 'resourcepacks-cache']);
    const walk = (dir, rel) => {
      for (const n of fs.readdirSync(dir)) {
        const r = rel ? `${rel}/${n}` : n; const full = path.join(dir, n); const st = fs.statSync(full);
        if (!rel && skipTop.has(n)) continue;
        if (st.isDirectory()) { walk(full, r); continue; }
        if (n.endsWith('.part') || n.endsWith('.disabled') || listed.has(r)) continue;
        entries.push({ name: `overrides/${r}`, data: fs.readFileSync(full) });
      }
    };
    walk(idir, '');
    const deps = { minecraft: inst.mcVersion };
    if (inst.loader !== 'vanilla' && inst.versionId) { const pre = `${inst.loader}-loader-`; deps[`${inst.loader}-loader`] = inst.versionId.slice(pre.length, -(inst.mcVersion.length + 1)); }
    const index = { formatVersion: 1, game: 'minecraft', versionId: '1.0.0', name: inst.name, summary: 'Exported from Shoaib Launcher', files, dependencies: deps };
    writeZip(dest, [{ name: 'modrinth.index.json', data: Buffer.from(JSON.stringify(index, null, 2)) }, ...entries]);
    return { files: files.length, overrides: entries.length };
  }
}
module.exports = { Content, DIRS, safeName };
