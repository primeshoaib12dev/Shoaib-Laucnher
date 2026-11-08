'use strict';
const fs = require('fs');
const path = require('path');
const { fetchJson } = require('./versions');

const LOADER_URLS = { fabric: 'https://meta.fabricmc.net/v2', quilt: 'https://meta.quiltmc.org/v3' };
const SUPPORTED = ['vanilla', 'fabric', 'quilt'];

/** Loader versions that exist for a Minecraft version (newest first). Throws a clear error if unsupported. */
async function loaderVersions(loader, mc, urls = LOADER_URLS) {
  if (loader === 'vanilla') return [];
  if (!urls[loader]) throw new Error(`${loader} is not supported yet`);
  let list;
  try { list = await fetchJson(`${urls[loader]}/versions/loader/${encodeURIComponent(mc)}`); }
  catch (e) { throw new Error(`Could not load ${loader} versions for ${mc}: ${e.message}`); }
  if (!Array.isArray(list) || !list.length) throw new Error(`${loader} does not support Minecraft ${mc}`);
  return list.map((x) => ({ version: x.loader.version, stable: x.loader.stable !== false }));
}

/** Download the official launcher profile for loader+MC and register it as a local version. Returns its version id. */
async function installLoaderProfile(d, loader, mc, loaderVersion, urls = LOADER_URLS) {
  if (loader === 'vanilla') return mc;
  const versions = await loaderVersions(loader, mc, urls);
  const lv = loaderVersion || (versions.find((v) => v.stable) || versions[0]).version;
  if (!versions.some((v) => v.version === lv)) throw new Error(`${loader} ${lv} is not available for Minecraft ${mc}`);
  const profile = await fetchJson(`${urls[loader]}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
  if (!profile?.id || !profile.mainClass) throw new Error(`Invalid ${loader} profile received`);
  const dir = path.join(d.versions, profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile));
  return profile.id;
}
module.exports = { loaderVersions, installLoaderProfile, LOADER_URLS, SUPPORTED };
