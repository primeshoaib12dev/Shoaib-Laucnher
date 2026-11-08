'use strict';
// Keybinding / mouse setup written straight into the instance's options.txt (Minecraft 1.13+ key format).
const fs = require('fs');
const path = require('path');

const KEYS = [
  ['key.forward', 'Walk forward', 'key.keyboard.w'], ['key.back', 'Walk backward', 'key.keyboard.s'], ['key.left', 'Strafe left', 'key.keyboard.a'], ['key.right', 'Strafe right', 'key.keyboard.d'],
  ['key.jump', 'Jump', 'key.keyboard.space'], ['key.sneak', 'Sneak', 'key.keyboard.left.shift'], ['key.sprint', 'Sprint', 'key.keyboard.left.control'],
  ['key.attack', 'Attack / Destroy', 'key.mouse.left'], ['key.use', 'Use item / Place block', 'key.mouse.right'], ['key.pickItem', 'Pick block', 'key.mouse.middle'],
  ['key.inventory', 'Open inventory', 'key.keyboard.e'], ['key.drop', 'Drop item', 'key.keyboard.q'], ['key.swapOffhand', 'Swap item with offhand', 'key.keyboard.f'],
  ['key.chat', 'Open chat', 'key.keyboard.t'], ['key.command', 'Open command', 'key.keyboard.slash'], ['key.playerlist', 'List players', 'key.keyboard.tab'],
  ['key.togglePerspective', 'Toggle perspective', 'key.keyboard.f5'], ['key.screenshot', 'Screenshot', 'key.keyboard.f2'], ['key.fullscreen', 'Fullscreen', 'key.keyboard.f11'], ['key.advancements', 'Advancements', 'key.keyboard.l'],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`key.hotbar.${n}`, `Hotbar slot ${n}`, `key.keyboard.${n}`]),
];
const KEY_RE = /^key\.(keyboard|mouse)\.[a-z0-9._]+$/;
const OPTS = { mouseSensitivity: 'num', invertYMouse: 'bool', autoJump: 'bool', toggleSprint: 'bool', toggleCrouch: 'bool', rawMouseInput: 'bool' };
const OPT_DEFAULT = { mouseSensitivity: 0.5, invertYMouse: false, autoJump: false, toggleSprint: false, toggleCrouch: false, rawMouseInput: true };

function modernKeys(mc) { const m = /^1\.(\d+)/.exec(mc); return m ? +m[1] >= 13 : /^\d\dw\d/.test(mc); }

class Controls {
  constructor(svc) { this.svc = svc; }
  _file(id) { const i = this.svc._get(id); return { inst: i, file: path.join(this.svc.d.instances, i.id, 'options.txt') }; }
  _read(file) { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.length); } catch { return []; } }
  get(instanceId) {
    const { inst, file } = this._file(instanceId);
    if (!modernKeys(inst.mcVersion)) return { supported: false, reason: `Key setup supports Minecraft 1.13 and newer (this instance uses ${inst.mcVersion}).` };
    const map = new Map(this._read(file).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i), l.slice(i + 1)]; }));
    const keys = KEYS.map(([id, label, def]) => ({ id, label, def, value: map.get('key_' + id) || def }));
    const options = {};
    for (const [k, t] of Object.entries(OPTS)) { const v = map.get(k); options[k] = v == null ? OPT_DEFAULT[k] : t === 'bool' ? v === 'true' : parseFloat(v); }
    return { supported: true, keys, options, fileExists: fs.existsSync(file) };
  }
  set(instanceId, { keys = {}, options = {} } = {}) {
    const { inst, file } = this._file(instanceId);
    if (this.svc.games.has(instanceId)) throw new Error('Close the game first, it would overwrite your changes on exit');
    if (!modernKeys(inst.mcVersion)) throw new Error('Key setup supports Minecraft 1.13 and newer');
    const upd = new Map();
    for (const [id, v] of Object.entries(keys)) {
      if (!KEYS.some((k) => k[0] === id)) throw new Error(`Unknown control ${id}`);
      if (v !== 'key.keyboard.unknown' && !KEY_RE.test(v)) throw new Error(`Invalid key for ${id}`);
      upd.set('key_' + id, v);
    }
    for (const [k, v] of Object.entries(options)) {
      if (!OPTS[k]) throw new Error(`Unknown option ${k}`);
      if (OPTS[k] === 'bool') upd.set(k, v ? 'true' : 'false');
      else { const n = Number(v); if (!(n >= 0 && n <= 1)) throw new Error('Mouse sensitivity must be between 0 and 1'); upd.set(k, String(n)); }
    }
    const lines = this._read(file); const seen = new Set();
    const out = lines.map((l) => { const k = l.slice(0, l.indexOf(':')); if (upd.has(k)) { seen.add(k); return `${k}:${upd.get(k)}`; } return l; });
    for (const [k, v] of upd) if (!seen.has(k)) out.push(`${k}:${v}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, out.join('\n') + '\n');
    return this.get(instanceId);
  }
  reset(instanceId) {
    const { file } = this._file(instanceId);
    if (this.svc.games.has(instanceId)) throw new Error('Close the game first');
    const out = this._read(file).filter((l) => !l.startsWith('key_key.'));
    if (fs.existsSync(file)) fs.writeFileSync(file, out.join('\n') + '\n');
    return this.get(instanceId);
  }
}
module.exports = { Controls, KEYS, modernKeys };
