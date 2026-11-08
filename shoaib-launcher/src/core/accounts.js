'use strict';
// Offline (local) profiles. Microsoft accounts arrive in milestone M2.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

/** Same algorithm vanilla servers use for offline-mode UUIDs (UUIDv3 of "OfflinePlayer:<name>"). */
function offlineUuid(name) {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function createOfflineProfile(name) {
  if (!NAME_RE.test(name || '')) throw new Error('Username must be 3-16 characters: letters, numbers, underscore');
  return { type: 'offline', name, uuid: offlineUuid(name), id: 'offline:' + name.toLowerCase() };
}

class AccountStore {
  constructor(d) { this.file = path.join(d.root, 'accounts.json'); this.data = { selected: null, accounts: [] }; this.load(); }
  load() { try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* new */ } }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
  list() { return this.data.accounts; }
  addOffline(name) {
    const p = createOfflineProfile(name);
    if (this.data.accounts.some((a) => a.id === p.id)) throw new Error('A profile with this name already exists');
    this.data.accounts.push(p);
    if (!this.data.selected) this.data.selected = p.id;
    this.save(); return p;
  }
  rename(id, newName) {
    const a = this.data.accounts.find((x) => x.id === id);
    if (!a || a.type !== 'offline') throw new Error('Only offline profiles can be renamed');
    const p = createOfflineProfile(newName);
    if (this.data.accounts.some((x) => x.id === p.id && x.id !== id)) throw new Error('A profile with this name already exists');
    Object.assign(a, p);
    if (this.data.selected === id) this.data.selected = p.id;
    this.save(); return a;
  }
  remove(id) {
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id);
    if (this.data.selected === id) this.data.selected = this.data.accounts[0]?.id || null;
    this.save();
  }
  select(id) { if (!this.data.accounts.some((a) => a.id === id)) throw new Error('Unknown account'); this.data.selected = id; this.save(); }
  selected() { return this.data.accounts.find((a) => a.id === this.data.selected) || null; }
}
module.exports = { offlineUuid, createOfflineProfile, AccountStore, NAME_RE };
