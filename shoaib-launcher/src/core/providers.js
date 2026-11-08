'use strict';
// Content providers: Modrinth (public API) and CurseForge (needs the user's own API key).
// Both return the same normalized shapes:
//   project: {id, source, slug, title, author, description, iconUrl, downloads, follows, type, categories, webUrl}
//   version: {id, projectId, name, number, mcVersions, loaders, datePublished, file:{url,filename,sha1,sha512,size}|null, restricted, webUrl, deps:[{projectId,versionId,type}]}
const UA = 'ShoaibLauncher/1.0 (Mod By Shoaib)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const timeoutMs = () => Number(process.env.SHOAIB_HTTP_TIMEOUT) || 20000;
/** Turn a low-level fetch failure into a message a person can act on. */
function codeOf(e) {
  for (let x = e, i = 0; x && i < 4; x = x.cause, i++) { if (x.code) return x.code; const sub = Array.isArray(x.errors) && x.errors.find((y) => y && y.code); if (sub) return sub.code; }
  return '';
}
function describeNetError(e) {
  const code = codeOf(e);
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `timed out after ${Math.round(timeoutMs() / 1000)}s (slow or blocked network)`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `DNS lookup failed [${code}] (no internet, or DNS not working)`;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return `connection failed [${code}]`;
  if (/CERT|TLS|SSL|LEAF/i.test(code)) return `TLS certificate problem [${code}] (check the date/time and CA certificates)`;
  return `${e?.message || 'unknown error'}${code ? ` [${code}]` : ''}`;
}
function netHint(msg) {
  if (/DNS/.test(msg)) return 'Check your internet. On Ubuntu inside a phone (proot) set a DNS server: echo "nameserver 8.8.8.8" > /etc/resolv.conf';
  if (/TLS/.test(msg)) return 'Fix the system date/time and install ca-certificates (sudo apt install ca-certificates).';
  if (/timed out|connection failed/.test(msg)) return 'The site could not be reached. Try another network, disable VPN/proxy, or retry in a minute.';
  return '';
}

async function http(url, { method = 'GET', body, headers = {} } = {}, label = 'API') {
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(url, { method, signal: AbortSignal.timeout(timeoutMs()), headers: { 'User-Agent': UA, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { if (attempt < 1) { await sleep(400); continue; } throw new Error(`${label}: ${describeNetError(e)}`); }
    if (res.status === 429 && attempt < 3) { await sleep((Number(res.headers.get('retry-after')) || 2) * 1000); continue; }
    if (res.status >= 500 && attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(`${label}: access denied (HTTP ${res.status}). Check your API key.`);
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    try { return await res.json(); } catch { throw new Error(`${label}: unexpected (non-JSON) answer, a proxy or captive portal may be interfering`); }
  }
}

// ---------------- Modrinth ----------------
const MR_TYPES = { mod: 'mod', modpack: 'modpack', resourcepack: 'resourcepack', shader: 'shader' };
class Modrinth {
  constructor(base = 'https://api.modrinth.com/v2') { this.base = base; this.name = 'modrinth'; }
  _loaders(loader) { return loader === 'quilt' ? ['quilt', 'fabric'] : loader && loader !== 'vanilla' ? [loader] : []; }
  _project(h) {
    return { id: h.project_id || h.id, source: 'modrinth', slug: h.slug, title: h.title, author: h.author || '', description: h.description, iconUrl: h.icon_url || '', downloads: h.downloads, follows: h.follows,
      type: h.project_type, categories: h.categories || [], webUrl: `https://modrinth.com/${h.project_type}/${h.slug}` };
  }
  async search(type, { query = '', mc, loader, sort = 'follows', offset = 0, limit = 20 } = {}) {
    if (!MR_TYPES[type]) throw new Error(`Unknown content type ${type}`);
    const facets = [[`project_type:${type}`]];
    if (mc) facets.push([`versions:${mc}`]);
    if ((type === 'mod' || type === 'modpack') && loader && loader !== 'vanilla') facets.push(this._loaders(loader).map((l) => `categories:${l}`));
    const index = sort === 'relevance' && !query ? 'follows' : (['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(sort) ? sort : 'follows');
    const q = new URLSearchParams({ query, facets: JSON.stringify(facets), index, limit: String(limit), offset: String(offset) });
    const r = await http(`${this.base}/search?${q}`, {}, 'Modrinth');
    return { total: r.total_hits, hits: r.hits.map((h) => this._project(h)) };
  }
  async project(id) { return this._project(await http(`${this.base}/project/${encodeURIComponent(id)}`, {}, 'Modrinth')); }
  _version(v) {
    const files = v.files || [];
    const f = files.find((x) => x.primary) || files[0];
    return { id: v.id, projectId: v.project_id, name: v.name, number: v.version_number, mcVersions: v.game_versions || [], loaders: v.loaders || [], datePublished: v.date_published,
      file: f ? { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, sha512: f.hashes?.sha512, size: f.size } : null, restricted: false, webUrl: '',
      deps: (v.dependencies || []).map((d) => ({ projectId: d.project_id, versionId: d.version_id, type: d.dependency_type })) };
  }
  async versions(projectId, { mc, loader, type } = {}) {
    const q = new URLSearchParams();
    if (mc) q.set('game_versions', JSON.stringify([mc]));
    const l = this._loaders(loader);
    if (l.length && (type === 'mod' || type === 'modpack')) q.set('loaders', JSON.stringify(l));
    const r = await http(`${this.base}/project/${encodeURIComponent(projectId)}/version?${q}`, {}, 'Modrinth');
    return r.map((v) => this._version(v));
  }
  async version(id) { return this._version(await http(`${this.base}/version/${encodeURIComponent(id)}`, {}, 'Modrinth')); }
  async identify(sha1s) { // hash -> version
    if (!sha1s.length) return {};
    const r = await http(`${this.base}/version_files`, { method: 'POST', body: { hashes: sha1s, algorithm: 'sha1' } }, 'Modrinth');
    return Object.fromEntries(Object.entries(r).map(([h, v]) => [h, this._version(v)]));
  }
  async latestFor(sha1s, { mc, loader }) {
    if (!sha1s.length) return {};
    const body = { hashes: sha1s, algorithm: 'sha1', game_versions: mc ? [mc] : undefined };
    const l = this._loaders(loader); if (l.length) body.loaders = l;
    const r = await http(`${this.base}/version_files/update`, { method: 'POST', body }, 'Modrinth');
    return Object.fromEntries(Object.entries(r).map(([h, v]) => [h, this._version(v)]));
  }
}

// ---------------- CurseForge ----------------
const CF_CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552 };
const CF_PATH = { mod: 'mc-mods', modpack: 'modpacks', resourcepack: 'texture-packs', shader: 'shaders' };
const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
class CurseForge {
  constructor(getKey, base = 'https://api.curseforge.com') { this.getKey = getKey; this.base = base; this.name = 'curseforge'; }
  _hdr() {
    const key = this.getKey();
    if (!key) throw new Error('CurseForge needs your own API key. Get a free key at console.curseforge.com and paste it in Settings.');
    return { 'x-api-key': key };
  }
  _get(p) { return http(`${this.base}${p}`, { headers: this._hdr() }, 'CurseForge'); }
  _project(m, type) {
    const t = type || Object.keys(CF_CLASS).find((k) => CF_CLASS[k] === m.classId) || 'mod';
    return { id: String(m.id), source: 'curseforge', slug: m.slug, title: m.name, author: m.authors?.[0]?.name || '', description: m.summary, iconUrl: m.logo?.thumbnailUrl || m.logo?.url || '', downloads: m.downloadCount, follows: m.thumbsUpCount || 0,
      type: t, categories: (m.categories || []).map((c) => c.name), webUrl: m.links?.websiteUrl || `https://www.curseforge.com/minecraft/${CF_PATH[t]}/${m.slug}` };
  }
  async search(type, { query = '', mc, loader, sort = 'follows', offset = 0, limit = 20 } = {}) {
    if (!CF_CLASS[type]) throw new Error(`Unknown content type ${type}`);
    const q = new URLSearchParams({ gameId: '432', classId: String(CF_CLASS[type]), searchFilter: query, sortField: String({ relevance: query ? 1 : 2, follows: 2, downloads: 6, updated: 3, newest: 11 }[sort] || 2), sortOrder: 'desc', pageSize: String(limit), index: String(offset) });
    if (mc) q.set('gameVersion', mc);
    if ((type === 'mod' || type === 'modpack') && CF_LOADER[loader]) q.set('modLoaderType', String(CF_LOADER[loader]));
    const r = await this._get(`/v1/mods/search?${q}`);
    return { total: r.pagination?.totalCount ?? r.data.length, hits: r.data.map((m) => this._project(m, type)) };
  }
  async project(id) { const r = await this._get(`/v1/mods/${encodeURIComponent(id)}`); return this._project(r.data); }
  _version(f, projectId, webBase) {
    const hash = (a) => f.hashes?.find((h) => h.algo === a)?.value;
    const gv = f.gameVersions || [];
    return { id: String(f.id), projectId: String(projectId ?? f.modId), name: f.displayName, number: f.fileName, mcVersions: gv.filter((x) => /^\d/.test(x)), loaders: gv.filter((x) => /^[A-Za-z]/.test(x)).map((x) => x.toLowerCase()), datePublished: f.fileDate,
      file: f.downloadUrl ? { url: f.downloadUrl, filename: f.fileName, sha1: hash(1), size: f.fileLength } : null, restricted: !f.downloadUrl, webUrl: webBase ? `${webBase}/files/${f.id}` : `https://www.curseforge.com/projects/${f.modId}`,
      deps: (f.dependencies || []).map((d) => ({ projectId: String(d.modId), versionId: null, type: d.relationType === 3 ? 'required' : d.relationType === 2 ? 'optional' : 'other' })) };
  }
  async versions(projectId, { mc, loader, type } = {}) {
    const q = new URLSearchParams({ pageSize: '30' });
    if (mc) q.set('gameVersion', mc);
    if ((type === 'mod' || type === 'modpack') && CF_LOADER[loader]) q.set('modLoaderType', String(CF_LOADER[loader]));
    let web = ''; try { web = (await this.project(projectId)).webUrl; } catch { /* optional */ }
    const r = await this._get(`/v1/mods/${encodeURIComponent(projectId)}/files?${q}`);
    return r.data.map((f) => this._version(f, projectId, web));
  }
  async version(id, projectId) { const r = await this._get(`/v1/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(id)}`); return this._version(r.data, projectId); }
  async filesByIds(ids) {
    const r = await http(`${this.base}/v1/mods/files`, { method: 'POST', headers: this._hdr(), body: { fileIds: ids } }, 'CurseForge');
    return r.data.map((f) => this._version(f, f.modId));
  }
}
module.exports = { Modrinth, CurseForge, http, UA, describeNetError, netHint, timeoutMs };
