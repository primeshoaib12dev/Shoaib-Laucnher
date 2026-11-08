'use strict';
const fs = require('fs');
const path = require('path');
const { DownloadQueue, fileValid, CancelSignal } = require('./download');
const V = require('./versions');
const { extractZip } = require('./zip');
const java = require('./java');
const log = require('./logger');

class InstallError extends Error { constructor(m, stage) { super(m); this.name = 'InstallError'; this.stage = stage; } }

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
}

/**
 * Install a Minecraft version end-to-end. Emits real progress through `queue` ('progress'/'stage').
 * Returns { id, javaPath }. Marks the version installed ONLY after all files verify.
 */
async function installVersion(d, id, { queue = new DownloadQueue(), urls = V.URLS, entry, installJava = true, onStage = () => {} } = {}) {
  const stage = (s) => { queue.stage = s; onStage(s); queue.emit('stage', s); log.info(`[install ${id}] stage: ${s}`); };
  try {
    require('./paths').ensure(d.versions, d.libraries, d.assets);
    try { fs.rmSync(V.markerPath(d, id), { force: true }); } catch { /* ignore */ }

    stage('metadata');
    const json = await V.resolveVersion(d, id, { urls, entry });
    // make sure parent jsons are local (resolveVersion downloads them via getVersionJson)
    const jarId = json._jarId;
    const jarJson = jarId === id ? json : await V.getVersionJson(d, jarId, { urls });
    const clientDl = json.downloads?.client || jarJson.downloads?.client;
    if (!clientDl) throw new InstallError(`Version ${id} has no client download in its metadata`, 'metadata');

    const need = (clientDl.size || 0);
    const libs = V.resolveLibraries(json, d, urls);
    const free = freeBytes(d.mc);
    const est = need + libs.reduce((a, l) => a + (l.size || 0), 0) + (json.assetIndex?.totalSize || 0);
    if (free != null && free < est * 1.1 + 50 * 1024 * 1024) throw new InstallError(`Not enough disk space: need about ${(est / 1048576).toFixed(0)} MB, only ${(free / 1048576).toFixed(0)} MB free`, 'disk');

    stage('client');
    const jarFile = path.join(d.versions, jarId, `${jarId}.jar`);
    let r = await queue.run([{ name: `${jarId}.jar`, url: clientDl.url, dest: jarFile, sha1: clientDl.sha1, size: clientDl.size }], 'client');
    if (r.failed.length) throw new InstallError(`Client jar failed: ${r.failed[0].error}`, 'client');

    stage('libraries');
    r = await queue.run(libs.map((l) => ({ name: path.basename(l.path), url: l.url, dest: l.path, sha1: l.sha1, size: l.size })), 'libraries');
    if (r.failed.length) throw new InstallError(`${r.failed.length} libraries failed: ${r.failed.map((f) => f.task.name + ' (' + f.error + ')').slice(0, 3).join('; ')}`, 'libraries');

    stage('assets');
    const ai = json.assetIndex;
    if (!ai) throw new InstallError('Version has no asset index', 'assets');
    const indexFile = path.join(d.assets, 'indexes', `${ai.id}.json`);
    r = await queue.run([{ name: `${ai.id}.json`, url: ai.url, dest: indexFile, sha1: ai.sha1, size: ai.size }], 'assets-index');
    if (r.failed.length) throw new InstallError(`Asset index failed: ${r.failed[0].error}`, 'assets');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    const objs = Object.entries(index.objects || {});
    const seen = new Set();
    const assetTasks = [];
    for (const [name, o] of objs) {
      if (seen.has(o.hash)) continue; seen.add(o.hash);
      const p2 = o.hash.slice(0, 2);
      assetTasks.push({ name, url: `${urls.resources}/${p2}/${o.hash}`, dest: path.join(d.assets, 'objects', p2, o.hash), sha1: o.hash, size: o.size });
    }
    r = await queue.run(assetTasks, 'assets');
    if (r.failed.length) throw new InstallError(`${r.failed.length} asset files failed: ${r.failed.slice(0, 3).map((f) => f.task.name + ' (' + f.error + ')').join('; ')}`, 'assets');
    if (index.virtual) { // legacy virtual asset tree
      for (const [name, o] of objs) {
        const src = path.join(d.assets, 'objects', o.hash.slice(0, 2), o.hash);
        const dst = path.join(d.assets, 'virtual', ai.id, name);
        if (!fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
      }
    }

    const lc = json.logging?.client?.file;
    if (lc) {
      r = await queue.run([{ name: lc.id, url: lc.url, dest: path.join(d.assets, 'log_configs', lc.id), sha1: lc.sha1, size: lc.size }], 'logging');
      if (r.failed.length) throw new InstallError(`Logging config failed: ${r.failed[0].error}`, 'logging');
    }

    stage('natives');
    const nativesDir = path.join(d.versions, id, 'natives');
    fs.rmSync(nativesDir, { recursive: true, force: true });
    fs.mkdirSync(nativesDir, { recursive: true });
    for (const l of libs.filter((x) => x.native)) {
      const excl = l.extract?.exclude || ['META-INF/'];
      extractZip(l.path, nativesDir, { flat: true, filter: (n) => /\.(dll|so|dylib|jnilib)$/i.test(n) && !excl.some((e) => n.startsWith(e)) });
    }

    let javaPath = null;
    if (installJava) {
      stage('java');
      const major = json.javaVersion?.majorVersion || 8;
      javaPath = (await java.ensureJava(d, major, { queue })).path;
    }

    stage('verify');
    const missing = [];
    if (!(await fileValid(jarFile, { sha1: clientDl.sha1, size: clientDl.size }))) missing.push(jarFile);
    for (const l of libs) if (!fs.existsSync(l.path)) missing.push(l.path);
    for (const t of assetTasks) if (!fs.existsSync(t.dest)) missing.push(t.dest);
    if (!fs.existsSync(path.join(d.versions, id, `${id}.json`))) missing.push(`${id}.json`);
    if (missing.length) throw new InstallError(`Verification failed, ${missing.length} required files missing (e.g. ${missing[0]})`, 'verify');

    stage('register');
    fs.writeFileSync(V.markerPath(d, id), JSON.stringify({ verified: true, installedAt: new Date().toISOString(), javaMajor: json.javaVersion?.majorVersion || 8, files: { libraries: libs.length, assets: assetTasks.length } }, null, 2));
    stage('done');
    return { id, javaPath };
  } catch (e) {
    if (e instanceof CancelSignal) { log.warn(`[install ${id}] cancelled`); throw e; }
    log.error(`[install ${id}] ${e.message}`);
    throw e instanceof InstallError ? e : new InstallError(e.message, queue.stage);
  }
}

module.exports = { installVersion, InstallError };
