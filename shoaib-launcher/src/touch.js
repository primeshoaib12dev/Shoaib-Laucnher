'use strict';
// Touch-control layouts (Pojav-style on-screen buttons): storage, validation, default layout.
// This is the layout data + editor backend. Injecting the presses into a running game is a separate runtime step.
const fs = require('fs');
const path = require('path');

const KEY_RE = /^key\.(keyboard|mouse)\.[a-z0-9._]+$/;
const TYPES = ['key', 'joystick', 'look'];

function defaultLayout() {
  const k = (id, label, key, x, y, w = 9, h = 14, shape = 'round') => ({ id, type: 'key', label, key, x, y, w, h, shape });
  return { buttons: [
    { id: 'move', type: 'joystick', label: 'Move', keys: { up: 'key.keyboard.w', left: 'key.keyboard.a', down: 'key.keyboard.s', right: 'key.keyboard.d' }, x: 4, y: 52, w: 22, h: 40, shape: 'round' },
    { id: 'look', type: 'look', label: 'Look', key: '', x: 40, y: 12, w: 38, h: 50, shape: 'area' },
    k('jump', 'JUMP', 'key.keyboard.space', 84, 60, 11, 18), k('sneak', 'SNEAK', 'key.keyboard.left.shift', 72, 78, 10, 16),
    k('attack', 'ATK', 'key.mouse.left', 72, 50, 10, 16), k('use', 'USE', 'key.mouse.right', 60, 66, 10, 16),
    k('inv', 'INV', 'key.keyboard.e', 46, 4, 8, 12, 'pill'), k('chat', 'CHAT', 'key.keyboard.t', 56, 4, 8, 12, 'pill'), k('tab', 'TAB', 'key.keyboard.tab', 66, 4, 8, 12, 'pill'), k('esc', 'ESC', 'key.keyboard.escape', 90, 4, 8, 12, 'pill'),
    ...[1, 2, 3, 4, 5].map((n, i) => k('h' + n, String(n), `key.keyboard.${n}`, 32 + i * 7, 86, 6, 11, 'pill')),
  ] };
}
function validate(layout) {
  if (!layout || !Array.isArray(layout.buttons)) throw new Error('Invalid layout');
  if (layout.buttons.length > 60) throw new Error('Too many buttons (max 60)');
  const ids = new Set();
  return { buttons: layout.buttons.map((b) => {
    if (!TYPES.includes(b.type)) throw new Error(`Unknown button type ${b.type}`);
    const id = String(b.id || '').slice(0, 24); if (!id || ids.has(id)) throw new Error('Buttons need unique ids'); ids.add(id);
    const n = (v, lo, hi, name) => { const x = Number(v); if (!(x >= lo && x <= hi)) throw new Error(`${name} must be between ${lo} and ${hi}`); return x; };
    const out = { id, type: b.type, label: String(b.label || '').slice(0, 8), x: n(b.x, 0, 100, 'x'), y: n(b.y, 0, 100, 'y'), w: n(b.w, 3, 60, 'width'), h: n(b.h, 3, 80, 'height'), shape: ['round', 'pill', 'area', 'square'].includes(b.shape) ? b.shape : 'round' };
    if (b.type === 'key') { if (!KEY_RE.test(b.key || '') && b.key !== 'key.keyboard.unknown') throw new Error(`Invalid key for ${id}`); out.key = b.key; }
    if (b.type === 'joystick') { for (const d of ['up', 'left', 'down', 'right']) if (!KEY_RE.test(b.keys?.[d] || '')) throw new Error(`Joystick ${d} key invalid`); out.keys = { ...b.keys }; }
    return out;
  }) };
}
class Touch {
  constructor(svc) { this.svc = svc; this.file = path.join(svc.d.root, 'touch-layouts.json'); }
  _read() { try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); return { active: d.active || 'Default', layouts: d.layouts || {} }; } catch { return { active: 'Default', layouts: {} }; } }
  _write(d) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(d, null, 2)); }
  list() {
    const d = this._read(); const layouts = { Default: defaultLayout(), ...d.layouts };
    return { active: layouts[d.active] ? d.active : 'Default', names: Object.keys(layouts), layouts };
  }
  save(name, layout) {
    name = String(name || '').trim(); if (!name || name.length > 30) throw new Error('Layout name must be 1-30 characters');
    if (name === 'Default') throw new Error('The Default layout is built in. Save your edits under another name.');
    const d = this._read(); d.layouts[name] = validate(layout); this._write(d); return this.list();
  }
  delete(name) { if (name === 'Default') throw new Error('Cannot delete the Default layout'); const d = this._read(); delete d.layouts[name]; if (d.active === name) d.active = 'Default'; this._write(d); return this.list(); }
  setActive(name) { const l = this.list(); if (!l.layouts[name]) throw new Error('Layout not found'); const d = this._read(); d.active = name; this._write(d); return this.list(); }
}
module.exports = { Touch, defaultLayout, validate };
