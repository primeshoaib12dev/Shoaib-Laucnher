'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
class Text { constructor(t) { this.nodeType = 3; this.text = String(t); } get textContent() { return this.text; } }
class El {
  constructor(tag) { this.nodeType = 1; this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this.className = ''; this.value = ''; this.checked = false; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 0; this.parent = null; }
  append(...k) { for (const c of k) { c.parent = this; this.children.push(c); } }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') El.ids[v] = this; if (k === 'value') this.value = v; if (k === 'disabled') this.disabled = true; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  get classList() { const s = this; return { contains: (c) => s.className.split(' ').includes(c), add: (c) => { s.className += ' ' + c; }, remove: (c) => { s.className = s.className.split(' ').filter((x) => x !== c).join(' '); } }; }
  set textContent(v) { this.children = v ? [new Text(v)] : []; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  get options() { return this.children.filter((c) => c.tag === 'option'); }
  querySelector(sel) { const cls = sel.slice(1); return this.find((e) => e.className.split(' ').includes(cls))[0] || null; }
  replaceWith() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  click() { if (this.disabled) return; (this.listeners.click || []).forEach((f) => f({ target: this })); }
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.find && c.find(pred, out)); return out; }
}
El.ids = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const buttonByText = (root, t) => root.find((e) => e.tag === 'button' && e.textContent === t)[0];

function boot(svc, extra = {}) {
  El.ids = {};
  let eventCb = () => {};
  for (const ev of ['install-progress', 'install-stage', 'install-state', 'install-done', 'game-log', 'game-state', 'game-exit', 'content-progress']) svc.on(ev, (p) => eventCb(ev, p));
  const doc = { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), getElementById: (id) => El.ids[id], addEventListener() {}, removeEventListener() {} };
  for (const id of ['topbar', 'view', 'toasts', 'modal-root', 'dl-status', 'pop-root']) { const e = new El('div'); e.setAttribute('id', id); }
  const win = { shoaib: { call: async (m, ...a) => svc[m](...a), openInstanceFolder: async () => {}, openLauncherFolder: async () => {}, pickJava: async () => null, pickFile: async () => null, pickSave: async () => null, pickFolder: async () => null, relaunch: async () => {}, openExternal: async () => true, onEvent: (cb) => { eventCb = cb; }, ...extra } };
  const ctx = vm.createContext({ window: win, document: doc, setTimeout, clearTimeout, console, Promise, Error, Number, Object, Math, Date });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8'), ctx);
  const byTitle = (t) => El.ids.topbar.find((e) => e.attrs.title === t)[0];
  return { view: () => El.ids.view, top: () => El.ids.topbar, pop: () => El.ids['pop-root'], toasts: () => El.ids.toasts.textContent, modal: () => El.ids['modal-root'], tap: (t) => byTitle(t).click(), emit: (n, p) => eventCb(n, p), ctx };
}
const fire = (el, type) => (el.listeners[type] || []).forEach((fn) => fn({ target: el }));
module.exports = { El, Text, boot, wait, buttonByText, fire };
