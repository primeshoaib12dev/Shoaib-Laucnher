'use strict';
// Worlds (saves) manager: list with real level.dat info, backup, delete, import from zip.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { listEntries, extractZip } = require('./core/zip');
const { safeName } = require('./content');

function parseNbt(buf) {
  let p = 0;
  const str = () => { const n = buf.readUInt16BE(p); p += 2; const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const tag = (t) => {
    switch (t) {
      case 1: return buf.readInt8(p++);
      case 2: { const v = buf.readInt16BE(p); p += 2; return v; }
      case 3: { const v = buf.readInt32BE(p); p += 4; return v; }
      case 4: { const v = buf.readBigInt64BE(p); p += 8; return v; }
      case 5: { const v = buf.readFloatBE(p); p += 4; return v; }
      case 6: { const v = buf.readDoubleBE(p); p += 8; return v; }
      case 7: { const n = buf.readInt32BE(p); p += 4 + n; return null; }
      case 8: return str();
      case 9: { const it = buf[p++]; const n = buf.readInt32BE(p); p += 4; const a = []; for (let i = 0; i < n; i++) a.push(tag(it)); return a; }
      case 10: { const o = {}; for (;;) { const tt = buf[p++]; if (tt === 0) return o; const k = str(); o[k] = tag(tt); } }
      case 11: { const n = buf.readInt32BE(p); p += 4 + n * 4; return null; }
      case 12: { const n = buf.readInt32BE(p); p += 4 + n * 8; return null; }
      default: throw new Error('Unknown NBT tag ' + t);
    }
  };
  if (buf[p++] !== 10) throw new Error('Not an NBT compound');
  str();
  return tag(10);
}
function dirSize(dir) { let n = 0; try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch { /* ignore */ } return n; }

const MODES = ['Survival', 'Creative', 'Adventure', 'Spectator'];
function readLevel(worldDir) {
  try {
    const nbt = parseNbt(zlib.gunzipSync(fs.readFileSync(path.join(worldDir, 'level.dat'))));
    const d = nbt.Data || {};
    return { levelName: d.LevelName || null, lastPlayed: d.LastPlayed != null ? Number(d.LastPlayed) : null, gameMode: MODES[d.GameType] || null, hardcore: !!d.hardcore, version: d.Version?.Name || null };
  } catch { return null; }
}

class Worlds {
  constructor(svc) { this.svc = svc; }
  _saves(id) { const i = this.svc._get(id); return { inst: i, dir: path.join(this.svc.d.instances, i.id, 'saves'), root: path.join(this.svc.d.instances, i.id) }; }
  list(instanceId) {
    const { dir, root } = this._saves(instanceId); const out = [];
    let names = []; try { names = fs.readdirSync(dir); } catch { /* none */ }
    for (const n of names) {
      const full = path.join(dir, n);
      try { if (!fs.statSync(full).isDirectory() || !fs.existsSync(path.join(full, 'level.dat'))) continue; } catch { continue; }
      const lv = readLevel(full);
      out.push({ folder: n, name: lv?.levelName || n, lastPlayed: lv?.lastPlayed || fs.statSync(full).mtimeMs, gameMode: lv?.gameMode || '', hardcore: !!lv?.hardcore, version: lv?.version || '', sizeBytes: dirSize(full) });
    }
    out.sort((a, b) => b.lastPlayed - a.lastPlayed);
    let backups = []; try { backups = fs.readdirSync(path.join(root, 'backups')).sort().reverse(); } catch { /* none */ }
    return { worlds: out, backups };
  }
  _world(instanceId, folder) {
    const { dir, root } = this._saves(instanceId);
    const name = safeName(folder); const full = path.resolve(dir, name);
    if (!full.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(full)) throw new Error('World not found');
    return { full, name, root };
  }
  _guard(instanceId) { if (this.svc.games.has(instanceId)) throw new Error('Close the game first (the world may be in use)'); }
  async backup(instanceId, folder) {
    this._guard(instanceId);
    const { full, name, root } = this._world(instanceId, folder);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(root, 'backups', `${name}-${stamp}`);
    await fs.promises.cp(full, dest, { recursive: true });
    return { backup: path.basename(dest) };
  }
  delete(instanceId, folder) { this._guard(instanceId); const { full } = this._world(instanceId, folder); fs.rmSync(full, { recursive: true, force: true }); return this.list(instanceId); }
  importZip(instanceId, zipPath) {
    this._guard(instanceId);
    const { dir } = this._saves(instanceId);
    const buf = fs.readFileSync(zipPath);
    const lv = listEntries(buf).filter((e) => /(^|\/)level\.dat$/.test(e.name)).sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
    if (!lv) throw new Error('This ZIP does not contain a Minecraft world (level.dat not found)');
    const prefix = lv.name.slice(0, -'level.dat'.length); // '' or 'World/'
    let name = safeName(prefix ? prefix.replace(/\/$/, '').split('/').pop() : path.basename(zipPath, path.extname(zipPath)));
    let target = path.join(dir, name), n = 1;
    while (fs.existsSync(target)) target = path.join(dir, `${name}-${++n}`);
    extractZip(zipPath, target, { filter: (e) => (e.startsWith(prefix) && e.length > prefix.length ? e.slice(prefix.length) : false) });
    return this.list(instanceId);
  }
}
module.exports = { Worlds, parseNbt, readLevel };
