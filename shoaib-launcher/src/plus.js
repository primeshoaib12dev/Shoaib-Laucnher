'use strict';
// Shoaib+ : free, local power tools (no account, no server). Auto world backups, backup to a folder,
// install queue, device-based recommended settings, launcher backup file.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeName } = require('./content');
const log = require('./core/logger');

const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

class Plus {
  constructor(svc) { this.svc = svc; this.run = null; }

  // ---------- recommended settings ----------
  recommend() {
    const totalMB = Math.floor(os.totalmem() / 1048576);
    let ramMax = Math.round((totalMB * 0.4) / 256) * 256;
    ramMax = Math.max(1024, Math.min(6144, ramMax));
    if (ramMax > totalMB * 0.6) ramMax = Math.max(512, Math.floor((totalMB * 0.5) / 256) * 256);
    const ramMin = Math.min(Math.max(512, Math.round((ramMax / 2) / 256) * 256), ramMax);
    return { totalMB, ramMin, ramMax, jvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+DisableExplicitGC',
      reason: `Your device has ${totalMB} MB of memory. About 40% goes to the game so the system stays responsive; G1 garbage collector flags reduce stutter pauses.` };
  }
  applyRecommended() { const r = this.recommend(); return this.svc.setSettings({ ramMin: r.ramMin, ramMax: r.ramMax, jvmArgs: r.jvmArgs }); }

  // ---------- world backups ----------
  _prune(backupsDir, folder, keep) {
    let names = []; try { names = fs.readdirSync(backupsDir); } catch { return []; }
    const mine = names.filter((n) => n.startsWith(folder + '-') && STAMP_RE.test(n.slice(folder.length + 1))).sort();
    const drop = mine.slice(0, Math.max(0, mine.length - keep));
    for (const n of drop) fs.rmSync(path.join(backupsDir, n), { recursive: true, force: true });
    return drop;
  }
  async backupWorlds(instanceId, { onlyChanged = false } = {}) {
    const svc = this.svc; const inst = svc._get(instanceId);
    if (svc.games.has(instanceId)) throw new Error('Close the game first');
    const { worlds } = svc.worlds.list(instanceId); const root = path.join(svc.d.instances, inst.id);
    const keep = svc.settings.plusBackupKeep || 5; const created = [];
    for (const w of worlds) {
      const full = path.join(root, 'saves', w.folder);
      if (onlyChanged) { // skip worlds not saved since their newest backup
        let last = 0; try { for (const n of fs.readdirSync(path.join(root, 'backups'))) if (n.startsWith(w.folder + '-') && STAMP_RE.test(n.slice(w.folder.length + 1))) last = Math.max(last, fs.statSync(path.join(root, 'backups', n)).mtimeMs); } catch { /* none */ }
        if (fs.statSync(path.join(full, 'level.dat')).mtimeMs <= last) continue;
      }
      const dest = path.join(root, 'backups', `${w.folder}-${stamp()}`);
      await fs.promises.cp(full, dest, { recursive: true }); created.push(path.basename(dest));
      this._prune(path.join(root, 'backups'), w.folder, keep);
    }
    return { created };
  }
  /** Called when a game closes. Never throws. */
  async autoBackup(instanceId) {
    try {
      if (!this.svc.settings.plusAutoBackup) return;
      const r = await this.backupWorlds(instanceId, { onlyChanged: true });
      if (r.created.length) this.svc.emit('plus-backup', { instanceId, created: r.created });
    } catch (e) { log.warn('auto backup failed: ' + e.message); }
  }

  // ---------- profile backup to any folder (Dropbox / Syncthing / Drive folder / SD card) ----------
  async backupProfile(instanceId, destDir) {
    const svc = this.svc; const inst = svc._get(instanceId);
    if (svc.games.has(instanceId)) throw new Error('Close the game first');
    if (!destDir || !path.isAbsolute(destDir)) throw new Error('Choose a full folder path');
    const src = path.join(svc.d.instances, inst.id); const base = path.resolve(destDir);
    if (base === path.resolve(src) || base.startsWith(path.resolve(src) + path.sep)) throw new Error('Choose a folder outside the profile');
    fs.mkdirSync(base, { recursive: true });
    const dest = path.join(base, `${safeName(inst.name)}-${stamp()}`);
    await fs.promises.cp(src, dest, { recursive: true });
    const { id, name, mcVersion, loader, loaderVersion, versionId, ramMax } = inst;
    fs.writeFileSync(path.join(dest, 'shoaib-profile.json'), JSON.stringify({ format: 'shoaib-profile', version: 1, instance: { id, name, mcVersion, loader, loaderVersion, versionId, ramMax } }, null, 2));
    return { path: dest };
  }
  async restoreProfile(srcDir) {
    const svc = this.svc; let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(srcDir, 'shoaib-profile.json'), 'utf8')); } catch { throw new Error('This folder is not a Shoaib profile backup (shoaib-profile.json missing)'); }
    if (meta.format !== 'shoaib-profile' || !meta.instance) throw new Error('Unsupported backup format');
    const m = meta.instance;
    const inst = svc.createInstance({ name: String(m.name || 'Restored').slice(0, 40), mcVersion: m.mcVersion, loader: m.loader || 'vanilla', loaderVersion: m.loaderVersion || '' });
    const dest = path.join(svc.d.instances, inst.id);
    await fs.promises.cp(srcDir, dest, { recursive: true, filter: (s) => path.basename(s) !== 'shoaib-profile.json' });
    const rec = svc._get(inst.id); rec.versionId = m.versionId || rec.versionId; rec.ramMax = m.ramMax || null; svc._save();
    return svc._status(rec);
  }

  // ---------- launcher backup file (settings, profile list, touch layouts, offline accounts) ----------
  exportBackup(dest) {
    const svc = this.svc; const { curseforgeKey, ...settings } = svc.settings; void curseforgeKey;
    const t = svc.touch.list(); const custom = Object.fromEntries(Object.entries(t.layouts).filter(([n]) => n !== 'Default'));
    const data = { format: 'shoaib-launcher-backup', version: 1, createdAt: new Date().toISOString(), settings, instances: svc.data.instances.map(({ id, name, mcVersion, loader, loaderVersion, versionId, ramMax }) => ({ id, name, mcVersion, loader, loaderVersion, versionId, ramMax })),
      touch: { active: t.active, layouts: custom }, accounts: svc.accounts.list().filter((a) => a.type === 'offline').map((a) => ({ name: a.name })) };
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(data, null, 2));
    return { instances: data.instances.length, layouts: Object.keys(custom).length, accounts: data.accounts.length };
  }
  importBackup(file) {
    const svc = this.svc; let d;
    try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Not a valid backup file'); }
    if (d.format !== 'shoaib-launcher-backup') throw new Error('This is not a Shoaib Launcher backup');
    const out = { settings: false, instances: 0, layouts: 0, accounts: 0 };
    if (d.settings) { const { curseforgeKey, ...rest } = d.settings; void curseforgeKey; svc.setSettings(rest); out.settings = true; }
    for (const i of d.instances || []) {
      if (svc.data.instances.some((x) => x.name === i.name && x.mcVersion === i.mcVersion && x.loader === i.loader)) continue; // already here
      try {
        const made = svc.createInstance({ name: i.name, mcVersion: i.mcVersion, loader: i.loader, loaderVersion: i.loaderVersion || '' });
        const rec = svc._get(made.id); rec.versionId = i.versionId || rec.versionId; rec.ramMax = i.ramMax || null; svc._save(); out.instances++;
      } catch (e) { log.warn('skip instance in backup: ' + e.message); }
    }
    for (const [n, l] of Object.entries(d.touch?.layouts || {})) { try { svc.touch.save(n, l); out.layouts++; } catch (e) { log.warn('skip layout: ' + e.message); } }
    if (d.touch?.active && d.touch.active !== 'Default') { try { svc.touch.setActive(d.touch.active); } catch { /* ignore */ } }
    for (const a of d.accounts || []) { try { svc.accounts.addOffline(a.name); out.accounts++; } catch { /* exists/invalid */ } }
    return out;
  }

  // ---------- install queue ----------
  queueInstalls(ids) {
    const svc = this.svc;
    if (this.run) throw new Error('A download queue is already running');
    if (!Array.isArray(ids) || !ids.length) throw new Error('Choose at least one profile');
    ids.forEach((id) => svc._get(id));
    const run = this.run = { ids: [...ids], cancel: false, failed: [], index: 0 };
    (async () => {
      try {
        for (let i = 0; i < run.ids.length && !run.cancel; i++) {
          run.index = i; svc.emit('plus-queue', { state: 'running', index: i, total: run.ids.length, instanceId: run.ids[i] });
          try { await svc.installInstance(run.ids[i]); } catch (e) { run.failed.push({ id: run.ids[i], error: e.message }); }
        }
      } finally { svc.emit('plus-queue', { state: run.cancel ? 'cancelled' : 'done', total: run.ids.length, failed: run.failed }); this.run = null; }
    })();
    return { started: true, total: ids.length };
  }
  cancelQueue() { if (this.run) { this.run.cancel = true; this.svc.cancelInstall(); } }
  state() { return { queueRunning: !!this.run, index: this.run?.index ?? 0, total: this.run?.ids.length ?? 0 }; }
}
module.exports = { Plus, STAMP_RE };
