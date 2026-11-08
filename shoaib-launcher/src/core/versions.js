'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { osName, archName } = require('./paths');
const { downloadFile, fileValid } = require('./download');

const URLS = {
  manifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  resources: 'https://resources.download.minecraft.net',
  libraries: 'https://libraries.minecraft.net/',
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'ShoaibLauncher/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Fetch the official manifest; falls back to the last cached copy when offline. */
async function fetchManifest(d, urls = URLS) {
  const cache = path.join(d.cache, 'version_manifest_v2.json');
  try {
    const m = await fetchJson(urls.manifest);
    fs.mkdirSync(d.cache, { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(m));
    return { manifest: m, offline: false };
  } catch (e) {
    if (fs.existsSync(cache)) return { manifest: JSON.parse(fs.readFileSync(cache, 'utf8')), offline: true };
    throw new Error(`Cannot load Minecraft version list (no internet and no cache): ${e.message}`);
  }
}

function localVersionIds(d) {
  try {
    return fs.readdirSync(d.versions).filter((id) => fs.existsSync(path.join(d.versions, id, `${id}.json`)));
  } catch { return []; }
}
function markerPath(d, id) { return path.join(d.versions, id, '.shoaib-installed.json'); }
function isInstalled(d, id) {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(d, id), 'utf8'));
    return m.verified === true && fs.existsSync(path.join(d.versions, id, `${id}.json`));
  } catch { return false; }
}

/** List versions merged with local install status. Supports search + type filter. */
async function listVersions(d, { type, search, installedOnly, urls } = {}) {
  let manifest = { versions: [] }, offline = false;
  try { ({ manifest, offline } = await fetchManifest(d, urls)); } catch { offline = true; }
  const map = new Map(manifest.versions.map((v) => [v.id, { id: v.id, type: v.type, releaseTime: v.releaseTime, url: v.url, sha1: v.sha1, installed: false }]));
  for (const id of localVersionIds(d)) {
    const e = map.get(id) || { id, type: 'custom', releaseTime: null, url: null, installed: false };
    e.installed = isInstalled(d, id);
    map.set(id, e);
  }
  let list = [...map.values()];
  if (type) list = list.filter((v) => v.type === type);
  if (search) list = list.filter((v) => v.id.toLowerCase().includes(search.toLowerCase()));
  if (installedOnly) list = list.filter((v) => v.installed);
  return { versions: list, offline, latest: manifest.latest || null };
}

/** Get a raw version json: local first, else download (hash-verified) using the manifest entry. */
async function getVersionJson(d, id, { urls, entry } = {}) {
  const file = path.join(d.versions, id, `${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let e = entry;
  if (!e) {
    const { manifest } = await fetchManifest(d, urls);
    e = manifest.versions.find((v) => v.id === id);
  }
  if (!e) throw new Error(`Version "${id}" is not in the official manifest and not installed locally`);
  await downloadFile({ url: e.url, dest: file, sha1: e.sha1 });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Resolve inheritsFrom chain into one merged definition. */
async function resolveVersion(d, id, opts = {}, depth = 0) {
  if (depth > 5) throw new Error('inheritsFrom chain too deep');
  const child = await getVersionJson(d, id, opts);
  if (!child.inheritsFrom) return { ...child, _chain: [id], _jarId: child.jar || id };
  const parent = await resolveVersion(d, child.inheritsFrom, opts, depth + 1);
  const merged = { ...parent, ...child };
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (child.arguments || parent.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  merged.assetIndex = child.assetIndex || parent.assetIndex;
  merged.assets = child.assets || parent.assets;
  merged.downloads = child.downloads || parent.downloads;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  merged.logging = child.logging || parent.logging;
  merged._chain = [id, ...parent._chain];
  merged._jarId = child.jar || parent._jarId;
  merged.id = id;
  return merged;
}

// ---- rules ----
function ruleMatches(rule, features = {}) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName()) return false;
    if (rule.os.arch && rule.os.arch !== (archName() === 'x64' ? 'x86_64' : archName()) && rule.os.arch !== archName()) return false;
    if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) return false;
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) if (!!features[k] !== v) return false;
  }
  return true;
}
function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const r of rules) if (ruleMatches(r, features)) allowed = r.action === 'allow';
  return allowed;
}

// ---- libraries ----
function mavenPath(name) {
  let [coords, ext] = name.split('@');
  const [g, a, v, c] = coords.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext || 'jar'}`;
}
function nativeClassifier(lib) {
  const c = lib.natives?.[osName()];
  return c ? c.replace('${arch}', archName() === 'x86' ? '32' : '64') : null;
}
/** Returns [{name,path,url,sha1,size,native,extract}] for libraries that apply to this OS. */
function resolveLibraries(json, d, urls = URLS) {
  const out = [];
  for (const lib of json.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const base = d.libraries;
    const nc = nativeClassifier(lib);
    if (nc) {
      const a = lib.downloads?.classifiers?.[nc];
      if (a) out.push({ name: `${lib.name}:${nc}`, path: path.join(base, a.path), url: a.url, sha1: a.sha1, size: a.size, native: true, legacy: true, extract: lib.extract });
      else if (lib.url || !lib.downloads) { const p = mavenPath(`${lib.name}:${nc}`); out.push({ name: `${lib.name}:${nc}`, path: path.join(base, p), url: (lib.url || urls.libraries) + p, native: true, legacy: true, extract: lib.extract }); }
      if (!lib.downloads?.artifact) continue;
    }
    const a = lib.downloads?.artifact;
    if (a && a.url !== '') {
      const isNew = /:natives-/.test(lib.name);
      out.push({ name: lib.name, path: path.join(base, a.path), url: a.url, sha1: a.sha1, size: a.size, native: isNew, extract: lib.extract });
    } else if (!lib.downloads) {
      const p = mavenPath(lib.name);
      out.push({ name: lib.name, path: path.join(base, p), url: (lib.url || urls.libraries) + p, sha1: lib.sha1, size: lib.size, native: /:natives-/.test(lib.name), extract: lib.extract });
    }
  }
  return out;
}

module.exports = { URLS, fetchJson, fetchManifest, listVersions, getVersionJson, resolveVersion, rulesAllow, mavenPath, resolveLibraries, isInstalled, markerPath, localVersionIds, fileValid };
