'use strict';
// Minimal dependency-free ZIP reader (store + deflate). Includes zip-slip protection.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function listEntries(buf) {
  let i = buf.length - 22;
  for (; i >= 0 && i > buf.length - 65600; i--) if (buf.readUInt32LE(i) === 0x06054b50) break;
  if (i < 0 || buf.readUInt32LE(i) !== 0x06054b50) throw new Error('Not a valid ZIP file (EOCD not found)');
  const total = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  const entries = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function entryData(buf, e) {
  const lh = e.localOff;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error('Corrupt ZIP local header');
  const start = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const raw = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`Unsupported ZIP compression method ${e.method} for ${e.name}`);
}
/** Extract file to dest. filter(name) -> bool or a new relative name (string). flat: drop directories. */
function extractZip(file, dest, { filter, flat = false } = {}) {
  const buf = fs.readFileSync(file);
  const root = path.resolve(dest);
  const written = [];
  for (const e of listEntries(buf)) {
    if (e.name.endsWith('/')) continue;
    let rel = e.name;
    if (filter) {
      const r = filter(e.name);
      if (!r) continue;
      if (typeof r === 'string') rel = r;
    }
    if (flat) rel = path.basename(rel);
    const out = path.resolve(root, rel);
    if (out !== root && !out.startsWith(root + path.sep)) throw new Error(`Blocked unsafe ZIP path: ${e.name}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entryData(buf, e));
    written.push(out);
  }
  return written;
}
function readEntry(file, name) {
  const buf = fs.readFileSync(file);
  const e = listEntries(buf).find((x) => x.name === name);
  return e ? entryData(buf, e) : null;
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
/** Write a ZIP (deflate) from [{name, data:Buffer}] to file. */
function writeZip(file, entries) {
  const parts = []; const central = []; let off = 0;
  for (const { name, data } of entries) {
    const nb = Buffer.from(name, 'utf8'); const comp = zlib.deflateRawSync(data); const useDeflate = comp.length < data.length;
    const body = useDeflate ? comp : data; const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, body); central.push(ch, nb); off += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([...parts, cd, e]));
}
module.exports = { listEntries, extractZip, readEntry, writeZip, crc32 };
