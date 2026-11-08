'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const log = require('./logger');

class PauseSignal extends Error { constructor() { super('paused'); this.name = 'PauseSignal'; } }
class CancelSignal extends Error { constructor() { super('cancelled'); this.name = 'CancelSignal'; } }
class FatalDownloadError extends Error { constructor(m) { super(m); this.name = 'FatalDownloadError'; } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Check an existing file against expected size/hash. */
async function fileValid(file, { sha1, sha256, sha512, size }) {
  let st;
  try { st = await fs.promises.stat(file); } catch { return false; }
  if (!st.isFile()) return false;
  if (size != null && st.size !== size) return false;
  if (sha1 && (await hashFile(file, 'sha1')) !== sha1.toLowerCase()) return false;
  if (sha256 && (await hashFile(file, 'sha256')) !== sha256.toLowerCase()) return false;
  if (sha512 && (await hashFile(file, 'sha512')) !== sha512.toLowerCase()) return false;
  return true;
}

/**
 * Download one file with resume (.part + Range), hash/size verification and retries.
 * Throws PauseSignal / CancelSignal when aborted via signal.reason.
 */
async function downloadFile({ url, dest, sha1, sha256, sha512, size, signal, onBytes, retries = 4, headers = {} }) {
  if (await fileValid(dest, { sha1, sha256, sha512, size })) return 'cached';
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let attempt = 0;
  for (;;) {
    try {
      if (signal?.aborted) throw signal.reason;
      let start = 0;
      try { start = (await fs.promises.stat(part)).size; } catch { /* none */ }
      const h = { 'User-Agent': 'ShoaibLauncher/1.0', ...headers };
      if (start > 0) h.Range = `bytes=${start}-`;
      const res = await fetch(url, { headers: h, signal, redirect: 'follow' });
      if (res.status === 416) { // part already complete or invalid
        await fs.promises.rm(part, { force: true });
        throw new Error('HTTP 416 (range not satisfiable), restarting');
      }
      if (!res.ok) {
        const msg = `HTTP ${res.status} for ${url}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new FatalDownloadError(msg);
        throw new Error(msg);
      }
      let append = false;
      if (start > 0) {
        if (res.status === 206) append = true;
        else { start = 0; await fs.promises.rm(part, { force: true }); }
      }
      if (append && onBytes) onBytes(0, start); // resumed bytes already on disk
      const counter = new Transform({ transform(chunk, _e, cb) { if (onBytes) onBytes(chunk.length, 0); cb(null, chunk); } });
      const streams = [Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: append ? 'a' : 'w' })];
      if (signal) streams.push({ signal });
      await pipeline(...streams);
      if (!(await fileValid(part, { sha1, sha256, sha512, size }))) {
        await fs.promises.rm(part, { force: true });
        throw new Error(`Integrity check failed for ${path.basename(dest)} (size/hash mismatch)`);
      }
      await fs.promises.rename(part, dest);
      return 'downloaded';
    } catch (e) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : e;
      if (e instanceof FatalDownloadError) throw e;
      if (e.name === 'AbortError') throw e;
      attempt++;
      if (attempt > retries) throw new Error(`Failed after ${retries} retries: ${e.message}`);
      log.warn(`download retry ${attempt}/${retries} ${url}: ${e.message}`);
      await sleep(Math.min(250 * 2 ** attempt, 4000));
    }
  }
}

/** Concurrent queue with real progress, speed, pause/resume/cancel. */
class DownloadQueue extends EventEmitter {
  constructor({ concurrency = 6, retries = 4 } = {}) {
    super();
    this.concurrency = concurrency;
    this.retries = retries;
    this.paused = false;
    this.cancelled = false;
    this.ctrl = new AbortController();
    this._waiters = [];
    this.stage = '';
    this.history = { completed: [], failed: [] };
  }
  pause() { if (this.paused || this.cancelled) return; this.paused = true; this.ctrl.abort(new PauseSignal()); this.emit('state', 'paused'); }
  resume() { if (!this.paused) return; this.paused = false; this.ctrl = new AbortController(); this._waiters.splice(0).forEach((r) => r()); this.emit('state', 'running'); }
  cancel() { this.cancelled = true; this.ctrl.abort(new CancelSignal()); this._waiters.splice(0).forEach((r) => r()); this.emit('state', 'cancelled'); }
  _waitResume() { return this.paused ? new Promise((r) => this._waiters.push(r)) : Promise.resolve(); }

  /** tasks: [{url,dest,sha1,size,name}] -> {downloaded, cached, failed:[{task,error}]} */
  async run(tasks, stage = 'downloading') {
    this.stage = stage;
    const total = tasks.length;
    const totalBytes = tasks.reduce((a, t) => a + (t.size || 0), 0);
    let doneFiles = 0, doneBytes = 0;
    const current = new Set();
    const samples = [];
    const result = { downloaded: 0, cached: 0, failed: [] };
    let lastEmit = 0;
    const emit = (force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 150) return;
      lastEmit = now;
      samples.push([now, doneBytes]);
      while (samples.length > 2 && now - samples[0][0] > 2000) samples.shift();
      const [t0, b0] = samples[0];
      const speed = now > t0 ? ((doneBytes - b0) * 1000) / (now - t0) : 0;
      this.emit('progress', { stage, doneFiles, totalFiles: total, doneBytes, totalBytes, speed, percent: totalBytes ? Math.min(100, (doneBytes / totalBytes) * 100) : (total ? (doneFiles / total) * 100 : 100), current: [...current] });
    };
    const pending = tasks.slice();
    const worker = async () => {
      for (;;) {
        if (this.cancelled) return;
        await this._waitResume();
        if (this.cancelled) return;
        const t = pending.shift();
        if (!t) return;
        const label = t.name || path.basename(t.dest);
        current.add(label);
        let counted = 0;
        try {
          const r = await downloadFile({ ...t, signal: this.ctrl.signal, retries: this.retries, onBytes: (n, resumed) => { counted += n + resumed; doneBytes += n + resumed; emit(false); } });
          if (r === 'cached') { result.cached++; doneBytes += t.size || 0; } else result.downloaded++;
          doneFiles++;
          this.history.completed.push(label);
        } catch (e) {
          doneBytes -= counted;
          if (e instanceof PauseSignal || (this.paused && !this.cancelled)) { pending.unshift(t); }
          else if (e instanceof CancelSignal || this.cancelled) { return; }
          else { result.failed.push({ task: t, error: e.message }); this.history.failed.push({ name: label, error: e.message }); doneFiles++; }
        } finally { current.delete(label); emit(true); }
      }
    };
    emit(true);
    await Promise.all(Array.from({ length: Math.max(1, Math.min(this.concurrency, total || 1)) }, worker));
    if (this.cancelled) throw new CancelSignal();
    emit(true);
    return result;
  }
}

module.exports = { downloadFile, DownloadQueue, hashFile, fileValid, PauseSignal, CancelSignal, FatalDownloadError };
