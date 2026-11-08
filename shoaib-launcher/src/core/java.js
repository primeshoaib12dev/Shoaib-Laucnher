'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const { osName, archName, isAndroid } = require('./paths');
const { extractZip } = require('./zip');
const { DownloadQueue } = require('./download');
const { fetchJson } = require('./versions');
const log = require('./logger');

const exe = process.platform === 'win32' ? 'java.exe' : 'java';

function parseMajor(text) {
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text) || /openjdk (\d+)/i.exec(text);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  return a === 1 ? parseInt(m[2] || '8', 10) : a;
}
function probe(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 15000 }, (err, stdout, stderr) => {
      const text = `${stderr}\n${stdout}`;
      const major = parseMajor(text);
      if (!major) return resolve(null);
      resolve({ path: javaPath, major, version: (/version "([^"]+)"/.exec(text) || [])[1] || String(major), is64: /64-Bit/i.test(text) });
    });
  });
}
function candidates(d) {
  const c = new Set();
  if (process.env.JAVA_HOME) c.add(path.join(process.env.JAVA_HOME, 'bin', exe));
  c.add(exe); // PATH
  const roots = process.platform === 'win32'
    ? ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\Zulu', 'C:\\Program Files (x86)\\Java']
    : ['/usr/lib/jvm', '/usr/java', '/opt/java', '/opt/jdk'];
  if (process.env.PREFIX) roots.push(path.join(process.env.PREFIX, 'lib', 'jvm')); // Termux
  roots.push(d.runtimes);
  for (const r of roots) {
    try {
      for (const n of fs.readdirSync(r)) {
        for (const sub of ['bin', path.join('Contents', 'Home', 'bin')]) c.add(path.join(r, n, sub, exe));
        // runtimes/jre-17/<extracted-folder>/bin/java
        try { for (const n2 of fs.readdirSync(path.join(r, n))) c.add(path.join(r, n, n2, 'bin', exe)); } catch { /* ignore */ }
      }
    } catch { /* missing dir */ }
  }
  return [...c].filter((p) => p === exe || fs.existsSync(p));
}
async function detectJava(d) {
  const found = [];
  const seen = new Set();
  for (const p of candidates(d)) {
    const info = await probe(p);
    if (!info) continue;
    const key = info.path === exe ? `PATH:${info.version}` : fs.realpathSync(info.path);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(info);
  }
  return found;
}
/** MC with Java 8 requirement breaks on newer JVMs; others need >= required. */
function isCompatible(major, required) { return required <= 8 ? major === 8 : major >= required; }

async function findCompatible(d, required) {
  const all = await detectJava(d);
  const ok = all.filter((j) => isCompatible(j.major, required));
  ok.sort((a, b) => (a.major === required ? -1 : 0) - (b.major === required ? -1 : 0) || a.major - b.major);
  return ok[0] || null;
}

async function installRuntime(d, major, { queue = new DownloadQueue({ concurrency: 1 }) } = {}) {
  if (isAndroid()) throw new Error(`Automatic Java download does not work on Android (the downloaded Java is for desktop Linux). In Termux install it with: pkg install openjdk-${major <= 17 ? 17 : 21}`);
  const adOs = { windows: 'windows', linux: 'linux', osx: 'mac' }[osName()];
  const adArch = { x64: 'x64', arm64: 'aarch64', x86: 'x32' }[archName()];
  if (!adOs || !adArch) throw new Error(`Automatic Java install is not supported on ${osName()}/${archName()}. Install Java ${major} manually and select it.`);
  const api = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${adArch}&image_type=jre&os=${adOs}&vendor=eclipse`;
  const assets = await fetchJson(api);
  const pkg = assets?.[0]?.binary?.package;
  if (!pkg?.link || !pkg?.checksum) throw new Error(`No trusted Java ${major} runtime found for ${adOs}/${adArch} from Adoptium`);
  const dir = path.join(d.runtimes, `jre-${major}`);
  const archive = path.join(d.runtimes, pkg.name);
  fs.mkdirSync(d.runtimes, { recursive: true });
  const r = await queue.run([{ name: pkg.name, url: pkg.link, dest: archive, sha256: pkg.checksum, size: pkg.size }], 'java');
  if (r.failed.length) throw new Error(`Java download failed: ${r.failed[0].error}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (/\.zip$/i.test(pkg.name)) extractZip(archive, dir);
  else execFileSync('tar', ['-xzf', archive, '-C', dir]);
  fs.rmSync(archive, { force: true });
  const info = (await detectJava(d)).find((j) => j.path.startsWith(dir) && j.major === major);
  if (!info) throw new Error(`Java ${major} was installed but could not be verified`);
  return info;
}

/** Find a compatible Java or install one. Never returns an incompatible Java silently. */
async function ensureJava(d, required, { queue, allowInstall = true } = {}) {
  const found = await findCompatible(d, required);
  if (found) return found;
  if (!allowInstall) throw new Error(`Java ${required} is required but not installed`);
  log.info(`Java ${required} not found, installing from Adoptium`);
  return installRuntime(d, required, { queue });
}

module.exports = { detectJava, findCompatible, ensureJava, installRuntime, isCompatible, parseMajor, probe };
