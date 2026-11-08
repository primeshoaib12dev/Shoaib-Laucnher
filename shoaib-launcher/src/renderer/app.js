'use strict';
// Shoaib Launcher UI (landscape / touch friendly, 16:9). Talks to src/service.js through window.shoaib.
const S = { instances: [], selected: null, accounts: [], selAccount: null, settings: null, page: 'home', params: {}, stack: [], pop: null, install: null, logs: [], latest: null };
const api = (m, ...a) => window.shoaib.call(m, ...a);
const byId = (id) => document.getElementById(id);

// ---------- helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>', back: '<path d="M19 12H5"/><path d="M12 5l-7 7 7 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>', pad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 10v5M4.5 12.5h5"/><circle cx="16" cy="11" r="1"/><circle cx="18.5" cy="14" r="1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>', up: '<path d="M6 15l6-6 6 6"/>', box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  dl: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>', folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>', monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  java: '<path d="M5 9h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3"/>', key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', pack: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M12 12v8M4 8l8 4 8-4"/>', cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>', spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>', up2: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>', sword: '<path d="M14 4l6-1-1 6-9 9-3-3zM7 17l-3 3"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', queue: '<path d="M4 6h16M4 12h16M4 18h10"/>', cloud: '<path d="M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4 4 0 0 1 0 9z"/>',
};
function ico(name, cls) { const s = h('span', { class: cls || 'ico' }); s.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`; return s; }
function toast(msg, err) { const t = h('div', { class: 'toast' + (err ? ' err' : '') }, msg); byId('toasts').append(t); setTimeout(() => t.remove(), err ? 7000 : 3500); }
async function run(fn) { try { return await fn(); } catch (e) { toast(e.message, true); return undefined; } }
const fmtB = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB');
const fmtN = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0));
const STAGES = { modpack: 'Modpack files', loader: 'Preparing mod loader', metadata: 'Reading version data', client: 'Game client', libraries: 'Libraries', assets: 'Game assets', 'assets-index': 'Asset index', logging: 'Logging config', natives: 'Native libraries', java: 'Java runtime', verify: 'Verifying files', register: 'Registering', done: 'Done' };
const openLink = (u) => window.shoaib.openExternal(u);
const curInst = () => S.instances.find((i) => i.id === S.selected) || null;
const curAcc = () => S.accounts.find((a) => a.id === S.selAccount) || null;
const loaderName = (l) => (l === 'vanilla' ? 'Vanilla' : l[0].toUpperCase() + l.slice(1));
const verId = (i) => i.versionId || i.mcVersion;

function modal(title, body, actions) {
  const root = byId('modal-root'); const close = () => { root.textContent = ''; };
  const acts = actions(close); root.textContent = '';
  root.append(h('div', { class: 'overlay', onmousedown: (e) => { if (e.target.classList && e.target.classList.contains('overlay')) close(); } }, h('div', { class: 'modal' }, h('h2', null, title), body, h('div', { class: 'actions' }, acts))));
  return close;
}
async function refresh() {
  const [i, a, s, pl] = await Promise.all([api('listInstances'), api('listAccounts'), api('getSettings'), api('getPlatform')]);
  S.instances = i.instances; S.selected = i.selected; S.accounts = a.accounts; S.selAccount = a.selected; S.settings = s; S.platform = pl;
}
function instSelect(value, onChange) {
  const sel = h('select', null, S.instances.map((i) => h('option', { value: i.id }, `${i.name} (${loaderName(i.loader)} ${i.mcVersion})`)));
  if (!S.instances.length) sel.append(h('option', { value: '' }, 'No profiles'));
  if (value) sel.value = value; sel.addEventListener('change', () => onChange(sel.value)); return sel;
}
function icon(url, title) {
  if (!url) return h('div', { class: 'ph' }, (title || '?')[0].toUpperCase());
  const img = h('img', { src: url, alt: '' }); img.addEventListener('error', () => img.replaceWith(h('div', { class: 'ph' }, (title || '?')[0].toUpperCase()))); return img;
}

// ---------- navigation ----------
function go(page, params) { S.stack.push({ page: S.page, params: S.params }); S.page = page; S.params = params || {}; S.pop = null; render(); }
function back() { const p = S.stack.pop(); if (p) { S.page = p.page; S.params = p.params; } else { S.page = 'home'; S.params = {}; } S.pop = null; render(); }
function goHome() { S.stack = []; S.page = 'home'; S.params = {}; S.pop = null; render(); }
const TITLES = { profiles: 'Versions', library: 'Library', browse: 'Browse', worlds: 'Worlds', controls: 'Controls', 'touch-edit': 'Touch controls', keybinds: 'Keyboard & mouse', settings: 'Launcher settings', plus: 'Shoaib+', 'set-video': 'Video and renderer', 'set-perf': 'Performance', java: 'Java runtimes', 'set-storage': 'Storage', 'set-cf': 'CurseForge', 'set-net': 'Network check', about: 'About' };

function renderTopbar() {
  const t = byId('topbar'); t.textContent = '';
  if (S.page === 'home') {
    const acc = curAcc();
    t.append(h('div', { class: 'brand' }, h('img', { src: '../assets/icon.png', alt: '' }), h('b', null, 'Shoaib Launcher')),
      h('button', { class: 'sq', title: 'Library', onclick: () => go('library') }, ico('book')),
      h('button', { class: 'sq', title: 'Controls', onclick: () => go('controls') }, ico('pad')),
      h('button', { class: 'sq', title: 'Worlds', onclick: () => go('worlds') }, ico('globe')),
      h('button', { class: 'chip-acc', onclick: () => togglePop('account') }, h('div', { class: 'av' }, acc ? acc.name[0].toUpperCase() : '?'), h('div', null, h('b', null, acc ? acc.name : 'No account'), h('span', null, acc ? 'Local account' : 'Tap to add'))),
      h('button', { class: 'sq', title: 'Settings', onclick: () => go('settings') }, ico('gear')));
  } else {
    t.append(h('button', { class: 'sq', title: 'Back', onclick: back }, ico('back')), h('div', { class: 'ttl' }, TITLES[S.page] || ''), h('button', { class: 'sq', title: 'Home', onclick: goHome }, ico('home')));
  }
}
function togglePop(name) { S.pop = S.pop === name ? null : name; renderPop(); }
function renderPop() {
  const root = byId('pop-root'); root.textContent = ''; if (!S.pop) return;
  root.append(h('div', { class: 'catch', onclick: () => { S.pop = null; renderPop(); } }));
  if (S.pop === 'account') {
    const p = h('div', { class: 'pop pop-account' }, h('div', { class: 'item', onclick: () => { S.pop = null; renderPop(); addAccountModal(); } }, ico('plus'), h('b', null, 'Add account')));
    for (const a of S.accounts) p.append(h('div', { class: 'item' + (a.id === S.selAccount ? ' sel' : ''), onclick: async () => { await run(() => api('selectAccount', a.id)); S.pop = null; await refresh(); render(); } }, h('div', { class: 'av' }, a.name[0].toUpperCase()), h('div', { class: 'grow' }, h('b', null, a.name), h('div', { class: 'mute small' }, 'Local account')),
      h('button', { class: 'trash', title: 'Remove', onclick: async (e) => { e.stopPropagation(); await run(() => api('removeAccount', a.id)); await refresh(); render(); } }, ico('trash'))));
    root.append(p);
  } else if (S.pop === 'play') {
    const p = h('div', { class: 'pop pop-play' });
    for (const i of S.instances) p.append(h('div', { class: 'item' + (i.id === S.selected ? ' sel' : ''), onclick: async () => { await run(() => api('selectInstance', i.id)); S.pop = null; await refresh(); render(); } }, ico('cube'), h('div', { class: 'grow' }, h('b', null, i.name), h('div', { class: 'mute small' }, `${loaderName(i.loader)} • ${verId(i)}`)), i.installed ? h('span', { class: 'chip ok' }, 'ready') : h('span', { class: 'chip warn' }, 'not downloaded')));
    p.append(h('div', { class: 'item', onclick: () => { S.pop = null; go('profiles'); } }, ico('box'), h('b', null, 'Manage versions')));
    root.append(p);
  }
}
function addAccountModal() {
  const n = h('input', { placeholder: 'Username (3-16, letters/numbers/_)', maxlength: 16 });
  modal('Add account', h('div', null, h('p', { class: 'mute small' }, 'Local accounts work in singleplayer and on servers with online-mode=false.'), h('label', null, 'Username'), n, h('div', { class: 'row' }, h('button', { class: 'btn', disabled: true }, 'Microsoft login — coming soon'))), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => { const r = await run(() => api('addOfflineAccount', n.value)); if (r) { close(); await refresh(); render(); toast('Account added'); } } }, 'Add')]);
}

// ---------- install / play ----------
async function install(id) {
  if (S.install) return toast('A download is already running', true);
  S.install = { instanceId: id, percent: 0, stage: 'loader', paused: false }; render();
  await run(() => api('installInstance', id));
  if (S.install && S.install.instanceId === id) { S.install = null; await refresh(); render(); }
}
async function playInst(id) {
  const r = await run(() => api('play', id));
  if (r) { S.logs = []; (r.warnings || []).forEach((w) => toast('Warning: ' + w, true)); toast('Launching…'); }
}
function progressPanel() {
  const p = S.install; const bar = h('i'); bar.style.width = (p.percent || 0).toFixed(1) + '%';
  return h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Downloading: ' + (STAGES[p.stage] || p.stage)), h('b', null, (p.percent || 0).toFixed(1) + '%')), h('div', { class: 'bar' }, bar),
    h('p', { class: 'mute small' }, p.totalFiles != null ? `${p.doneFiles}/${p.totalFiles} files • ${fmtB(p.doneBytes || 0)}${p.totalBytes ? ' / ' + fmtB(p.totalBytes) : ''} • ${fmtB(p.speed || 0)}/s` : 'Working…', p.current?.length ? ` • ${p.current[0]}` : ''),
    h('div', { class: 'row' }, p.paused ? h('button', { class: 'btn', onclick: () => run(() => api('resumeInstall')) }, 'Resume') : h('button', { class: 'btn', onclick: () => run(() => api('pauseInstall')) }, 'Pause'), h('button', { class: 'btn danger', onclick: () => run(() => api('cancelInstall')) }, 'Cancel')));
}

// ---------- Home ----------
let latestLoading = false;
function fetchLatest() {
  if (latestLoading) return; latestLoading = true;
  api('listVersions', {}).then((r) => { S.latest = r.latest || { none: true }; }).catch(() => { S.latest = { none: true }; }).finally(() => { latestLoading = false; S.latestAt = Date.now(); if (S.page === 'home') render(); });
}
async function pageHome() {
  const i = curInst(); const acc = curAcc(); const v = h('div', { class: 'home' });
  if (!S.latest || (S.latest.none && Date.now() - (S.latestAt || 0) > 60000)) fetchLatest();
  if (S.install && i && S.install.instanceId === i.id) v.append(progressPanel());
  else {
    const card = h('div', { class: 'panel' });
    if (S.latest && S.latest.release) card.append(h('h1', null, `Minecraft ${S.latest.release} is the latest release`), h('p', { class: 'sub' }, `Latest snapshot: ${S.latest.snapshot}. Pick any version from the official Mojang list under Versions.`));
    else card.append(h('h1', null, 'Welcome to Shoaib Launcher'), h('p', { class: 'sub' }, 'Download any Minecraft version, then play. Version list loads from Mojang when you are online.'));
    if (i) card.append(h('p', null, h('b', null, 'Profile: '), `${i.name} — ${loaderName(i.loader)} • ${verId(i)} • `, i.running ? h('span', { class: 'chip ok' }, 'Running') : i.installed ? h('span', { class: 'chip ok' }, 'Ready to play') : h('span', { class: 'chip warn' }, 'Download needed')));
    else card.append(h('p', { class: 'mute' }, 'No profile yet. Press Versions, then Create new profile to choose a Minecraft version.'));
    if (S.platform && !S.platform.canPlay) card.append(h('div', { class: 'warnbox' }, S.platform.reason));
    else if (!acc) card.append(h('p', { class: 'mute' }, 'Add a local account (top right) to play.'));
    let st = null; try { st = await api('getStorage'); } catch { /* optional */ }
    const stat = (icn, label, val) => h('div', { class: 'stat' }, ico(icn), h('div', null, h('span', null, label), h('b', null, val)));
    card.append(h('div', { class: 'stats' }, stat('cpu', 'Game RAM', `${S.settings.ramMax} MB`), stat('folder', 'Free space', st && st.freeBytes != null ? fmtB(st.freeBytes) : '—'), stat('globe', 'Profiles', String(S.instances.length)),
      h('button', { class: 'plusbtn', onclick: () => go('plus') }, ico('star'), 'Shoaib+')));
    if (S.logs.length || (i && i.running)) card.append(h('div', { class: 'log', id: 'log' }, S.logs.join('') || 'Waiting for game output…'));
    v.append(card);
  }
  const busy = !!S.install; let main, sub, act, cls = '';
  if (!i) { main = 'Create profile'; sub = 'Pick a Minecraft version'; act = () => newProfileModal(); }
  else if (i.running) { main = 'Stop'; sub = `Running ${verId(i)}`; cls = ' stop'; act = () => api('stop', i.id); }
  else if (busy) { main = `${(S.install.percent || 0).toFixed(0)}%`; sub = 'Downloading…'; cls = ' off'; act = () => {}; }
  else if (!i.installed) { main = 'Download'; sub = `Version ${verId(i)}`; act = () => install(i.id); }
  else if (S.platform && !S.platform.canPlay) { main = 'Downloaded'; sub = 'Playing needs a desktop'; cls = ' off'; act = () => toast(S.platform.reason, true); }
  else if (!acc) { main = 'Add account'; sub = 'Needed to play'; act = () => addAccountModal(); }
  else { main = 'Play'; sub = `Version ${verId(i)}`; act = () => playInst(i.id); }
  v.append(h('div', { class: 'bigbar' }, h('button', { class: 'versions-btn', onclick: () => go('profiles') }, ico('box'), 'Versions'),
    h('div', { class: 'play' + cls }, h('button', { class: 'main', onclick: act }, h('b', null, main), h('span', null, sub)), h('button', { class: 'caret', title: 'Switch profile', onclick: () => togglePop('play') }, ico('up')))));
  return v;
}

// ---------- Versions / profiles ----------
async function pageProfiles() {
  const v = h('div', null, h('div', { class: 'cap' }, 'Profiles'));
  const g = h('div', { class: 'grid' });
  for (const i of S.instances) {
    g.append(h('div', { class: 'card' + (i.id === S.selected ? ' sel' : '') },
      h('div', { class: 'row', onclick: async () => { await run(() => api('selectInstance', i.id)); await refresh(); goHome(); } }, h('div', { class: 'lic ' + i.loader }, ico('cube')), h('div', { class: 'grow' }, h('b', null, i.name), h('div', { class: 'mute small' }, `${loaderName(i.loader)} - ${verId(i)}`)),
        i.installed ? h('span', { class: 'chip ok' }, 'downloaded') : h('span', { class: 'chip warn' }, 'not downloaded'),
        h('button', { class: 'trash', title: 'Delete', disabled: i.running, onclick: (e) => { e.stopPropagation(); confirmDelete(i); } }, ico('trash'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => editInstanceModal(i) }, 'Edit'),
        h('button', { class: 'btn', onclick: async () => { await run(() => api('duplicateInstance', i.id)); await refresh(); render(); toast('Duplicated'); } }, 'Duplicate'),
        h('button', { class: 'btn', onclick: async () => { const f = await window.shoaib.pickSave({ defaultPath: i.name + '.mrpack', filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] }); if (f) { const r = await run(() => api('contentExportMrpack', i.id, f)); if (r) { toast(`Exported (${r.files} downloadable mods + ${r.overrides} files)`); window.shoaib.afterSave(f); } } } }, 'Export'),
        h('button', { class: 'btn', onclick: () => run(() => window.shoaib.openInstanceFolder(i.id)) }, 'Folder'))));
  }
  g.append(h('div', { class: 'card', onclick: () => newProfileModal(), style: undefined }, h('div', { class: 'row' }, ico('plus'), h('b', null, 'Create new profile'))));
  v.append(g); return v;
}
function confirmDelete(i) {
  modal('Delete profile?', h('p', { class: 'mute' }, `"${i.name}" and ALL its worlds, mods and settings will be permanently deleted from disk.`), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn danger', onclick: async () => { close(); await run(() => api('deleteInstance', i.id)); await refresh(); render(); } }, 'Delete')]);
}
function editInstanceModal(i) {
  const name = h('input', { value: i.name, maxlength: 40 }), ram = h('input', { type: 'number', min: 256, step: 256, value: i.ramMax || '', placeholder: 'default (' + S.settings.ramMax + ')' }), java = h('input', { value: i.javaPath || '', placeholder: 'automatic' });
  let closeEdit = () => {};
  closeEdit = modal('Edit profile', h('div', null, h('label', null, 'Name'), name, h('label', null, 'Max RAM (MB), empty = launcher default'), ram, h('label', null, 'Java executable, empty = automatic'), java,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { closeEdit(); install(i.id); } }, 'Verify / repair game files')), h('p', { class: 'mute small' }, 'Re-checks every file of this version and downloads anything missing or damaged.')), (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async () => { const ok = await run(async () => { await api('renameInstance', i.id, name.value); await api('updateInstance', i.id, { ramMax: ram.value, javaPath: java.value }); return true; }); if (ok) { close(); await refresh(); render(); } } }, 'Save')]);
}
function newProfileModal(pre = {}) {
  const name = h('input', { value: pre.name || '', maxlength: 40, placeholder: 'Auto name' });
  const type = h('select', null, ['release', 'snapshot', 'old_beta', 'old_alpha'].map((t) => h('option', { value: t }, t)));
  const search = h('input', { placeholder: 'Search version, e.g. 1.21' });
  const ver = h('select'); const loader = h('select', null, h('option', { value: 'vanilla' }, 'Vanilla'), h('option', { value: 'fabric' }, 'Fabric'), h('option', { value: 'quilt' }, 'Quilt'), h('option', { value: 'forge', disabled: true }, 'Forge (coming soon)'), h('option', { value: 'neoforge', disabled: true }, 'NeoForge (coming soon)'));
  const lver = h('select'); const msg = h('div', { class: 'small mute' }); let create;
  const loadVersions = async () => {
    ver.textContent = ''; ver.append(h('option', null, 'Loading…'));
    const r = await run(() => api('listVersions', { type: type.value, search: search.value || undefined }));
    ver.textContent = '';
    for (const x of (r?.versions || []).slice(0, 400)) ver.append(h('option', { value: x.id }, x.id + (x.installed ? ' ✓' : '')));
    if (pre.mcVersion && [...ver.options].some((o) => o.value === pre.mcVersion)) ver.value = pre.mcVersion;
    msg.textContent = r?.offline ? 'Offline: showing cached version list.' : '';
    await loadLoader();
  };
  const loadLoader = async () => {
    lver.textContent = ''; if (create) create.disabled = false;
    if (loader.value === 'vanilla' || !ver.value) { lver.append(h('option', { value: '' }, '—')); return; }
    lver.append(h('option', null, 'Loading…'));
    try { const list = await api('loaderVersions', loader.value, ver.value); lver.textContent = ''; list.slice(0, 40).forEach((x) => lver.append(h('option', { value: x.version }, x.version + (x.stable ? '' : ' (beta)')))); msg.textContent = ''; }
    catch (e) { lver.textContent = ''; lver.append(h('option', { value: '' }, 'unavailable')); msg.textContent = e.message; if (create) create.disabled = true; }
  };
  type.addEventListener('change', loadVersions); ver.addEventListener('change', loadLoader); loader.addEventListener('change', loadLoader);
  let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadVersions, 250); });
  modal('Create new profile', h('div', null, h('label', null, 'Version type'), type, h('label', null, 'Search'), search, h('label', null, 'Minecraft version'), ver, h('label', null, 'Mod loader'), loader, h('label', null, 'Loader version'), lver, h('label', null, 'Profile name (optional)'), name, msg), (close) => {
    create = h('button', { class: 'btn primary', onclick: async () => {
      const nm = name.value.trim() || `${loaderName(loader.value)} ${ver.value}`;
      const inst = await run(() => api('createInstance', { name: nm, mcVersion: ver.value, loader: loader.value, loaderVersion: lver.value }));
      if (inst) { close(); await run(() => api('selectInstance', inst.id)); await refresh(); goHome(); toast('Profile created. Press Download to get this version.'); }
    } }, 'Create');
    return [h('button', { class: 'btn', onclick: close }, 'Cancel'), create];
  });
  loadVersions();
}

// ---------- Library hub ----------
function restrictedModal(list) {
  modal('Download manually', h('div', null, h('p', { class: 'mute' }, 'These files are not available to third-party launchers (the author disabled it). Open the page, download the file, then use Library → Import external mods.'),
    ...list.map((r) => h('div', { class: 'row' }, h('span', { class: 'grow' }, r.title || r.name), r.webUrl ? h('button', { class: 'btn', onclick: () => openLink(r.webUrl) }, 'Open page') : null))), (close) => [h('button', { class: 'btn primary', onclick: close }, 'OK')]);
}
function reportInstall(r) {
  if (r.installed.length) toast('Installed: ' + r.installed.map((x) => x.title).join(', '));
  if (r.missing?.length) toast(`${r.missing.length} dependency(ies) had no compatible version`, true);
  if (r.restricted.length) restrictedModal(r.restricted);
  if (!r.installed.length && !r.restricted.length) toast('Already installed');
}
async function afterModpack(r) {
  if (!r) return; await run(() => api('selectInstance', r.instance.id)); await refresh();
  if (r.missing?.length) restrictedModal(r.missing);
  toast(`Modpack "${r.instance.name}" ready. Downloading the game…`); S.stack = []; S.page = 'home'; render(); install(r.instance.id);
}
async function installModpackFlow(source, projectId, versionId) { afterModpack(await run(() => api('contentInstallModpack', { source, projectId, versionId }))); }
async function importModpackFile() {
  const f = await window.shoaib.pickFile({ title: 'Import modpack', filters: [{ name: 'Modpack', extensions: ['mrpack', 'zip'] }] }); if (!f) return;
  afterModpack(await run(() => api('contentImportModpack', f)));
}
S.lib = { instanceId: null };
async function pageLibrary() {
  const L = S.lib; if (!L.instanceId || !S.instances.some((i) => i.id === L.instanceId)) L.instanceId = S.selected || S.instances[0]?.id || null;
  const inst = S.instances.find((i) => i.id === L.instanceId);
  let tileN = 0; const tile = (icn, title, desc, fn) => h('button', { class: 'tile c' + (tileN++ % 4), onclick: fn }, h('div', { class: 'ic' }, ico(icn)), h('b', null, title), h('span', null, desc));
  const v = h('div', null, h('div', { class: 'panel' }, h('div', { class: 'row' }, ico('book'), h('div', null, h('h1', null, 'Library'), h('div', { class: 'mute' }, 'Import modpacks, download content and review what is installed in the active profile.')))));
  const need = (fn) => () => (inst ? fn() : toast('Create a profile first (Versions → Create new profile)', true));
  v.append(h('div', { class: 'grid3' },
    tile('pack', 'Import modpack', 'Open a .mrpack or .zip and create a ready instance.', importModpackFile),
    tile('cube', 'Browse modpacks', 'Search Modrinth and CurseForge modpacks.', () => go('browse', { type: 'modpack' })),
    tile('sword', 'Browse mods', 'Install .jar mods into the profile you choose.', need(() => go('browse', { type: 'mod' }))),
    tile('plus', 'Import external mods', 'Choose a .jar file and add it to the profile.', need(async () => { const f = await window.shoaib.pickFile({ title: 'Import mod', filters: [{ name: 'jar', extensions: ['jar'] }] }); if (f) { const r = await run(() => api('contentImportLocal', inst.id, 'mod', f)); if (r) { toast('Imported ' + r.title); render(); } } })),
    tile('img', 'Browse resource packs', 'Download texture packs into the profile.', need(() => go('browse', { type: 'resourcepack' }))),
    tile('spark', 'Browse shaders', 'Download shader packs (needs Iris on Fabric/Quilt).', need(() => go('browse', { type: 'shader' }))),
    tile('globe', 'Worlds', 'Back up, import and manage saved worlds.', () => go('worlds')),
    tile('up2', 'Export modpack', 'Save this profile as a .mrpack file.', need(async () => { const f = await window.shoaib.pickSave({ defaultPath: inst.name + '.mrpack', filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] }); if (f) { const r = await run(() => api('contentExportMrpack', inst.id, f)); if (r) { toast(`Exported (${r.files} downloadable mods + ${r.overrides} files)`); window.shoaib.afterSave(f); } } })),
    tile('folder', 'Open profile folder', 'Show the files of this profile.', need(() => run(() => window.shoaib.openInstanceFolder(inst.id))))));
  v.append(h('div', { class: 'cap' }, 'Installed content'));
  if (!inst) { v.append(h('div', { class: 'panel mute' }, 'No profile yet.')); return v; }
  v.append(h('div', { class: 'panel row' }, h('span', { class: 'mute' }, 'Profile'), instSelect(L.instanceId, (id) => { L.instanceId = id; render(); }),
    h('button', { class: 'btn', onclick: async () => { const u = await run(() => api('contentCheckUpdates', inst.id)); if (u) { L.updates = Object.fromEntries(u.map((x) => [x.type + ':' + x.filename, x])); toast(u.length ? `${u.length} update(s) available` : 'Everything is up to date'); render(); } } }, 'Check mod updates')));
  const data = await api('contentInstalled', inst.id);
  if (data.missing?.length) v.append(h('div', { class: 'warnbox' }, `${data.missing.length} modpack file(s) could not be downloaded automatically.`, ' ', h('button', { class: 'btn', onclick: () => restrictedModal(data.missing) }, 'Show')));
  const sections = [['mod', 'Mods', 'mods', ['jar']], ['resourcepack', 'Resource packs', 'resourcepacks', ['zip']], ['shader', 'Shaders', 'shaderpacks', ['zip']]];
  for (const [type, label, folder, ext] of sections) {
    const items = data[type]; const size = items.reduce((a, x) => a + x.size, 0);
    const panel = h('div', { class: 'panel' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, label), h('span', { class: 'mute' }, `${items.length} files • ${fmtB(size)}`),
      h('button', { class: 'btn', onclick: () => run(() => window.shoaib.openInstanceFolder(inst.id, folder)) }, 'Open folder'),
      h('button', { class: 'btn', onclick: async () => { const f = await window.shoaib.pickFile({ title: 'Import file', filters: [{ name: ext[0], extensions: ext }] }); if (f) { const r = await run(() => api('contentImportLocal', inst.id, type, f)); if (r) { toast('Imported ' + r.title); render(); } } } }, 'Import')));
    if (type === 'shader') {
      const iris = inst.loader === 'fabric' || inst.loader === 'quilt';
      panel.append(h('div', { class: 'warnbox' }, iris ? 'Shaders only work with Iris (+ Sodium) installed in this profile.' : `Shaders need Iris (Fabric/Quilt) or OptiFine. This profile is ${inst.loader}: create a Fabric profile for shaders.`),
        iris ? h('button', { class: 'btn primary', onclick: async () => { for (const slug of ['sodium', 'iris']) { const r = await run(() => api('contentInstall', { instanceId: inst.id, source: 'modrinth', projectId: slug, type: 'mod' })); if (r) reportInstall(r); } render(); } }, 'Install Iris + Sodium') : null);
    }
    if (!items.length) panel.append(h('p', { class: 'mute' }, 'Nothing here yet.'));
    for (const it of items) {
      const up = L.updates?.[type + ':' + it.base];
      panel.append(h('div', { class: 'item' + (it.enabled ? '' : ' off') }, icon(it.iconUrl, it.title), h('div', { class: 'grow' }, h('b', null, it.title), h('div', { class: 'mute small' }, `${it.base} • ${it.size ? fmtB(it.size) : 'folder'} • ${it.enabled ? 'Active' : 'Disabled'}`)), h('span', { class: 'chip' }, it.source),
        up ? h('button', { class: 'btn primary', onclick: async () => { const r = await run(() => api('contentUpdateItem', inst.id, type, it.base)); if (r) { delete L.updates[type + ':' + it.base]; toast('Updated to ' + r.filename); render(); } } }, 'Update → ' + up.latest) : null,
        h('button', { class: 'btn', onclick: async () => { await run(() => api('contentToggle', inst.id, type, it.filename)); render(); } }, it.enabled ? 'Disable' : 'Enable'),
        h('button', { class: 'trash', title: 'Remove', onclick: async () => { await run(() => api('contentRemove', inst.id, type, it.filename)); render(); } }, ico('trash'))));
    }
    v.append(panel);
  }
  return v;
}

// ---------- Browse (Modrinth / CurseForge) ----------
const TYPES = [['mod', 'Mods'], ['modpack', 'Modpacks'], ['resourcepack', 'Resource Packs'], ['shader', 'Shaders']];
S.browse = { source: 'modrinth', type: 'mod', query: '', sort: 'follows', anyVersion: false, instanceId: null, offset: 0 };
async function pageBrowse(params) {
  const B = S.browse; if (params && params.type) { B.type = params.type; B.offset = 0; }
  if (!B.instanceId || !S.instances.some((i) => i.id === B.instanceId)) B.instanceId = S.selected || S.instances[0]?.id || null;
  const inst = S.instances.find((i) => i.id === B.instanceId);
  const v = h('div', null);
  const tabs = h('div', { class: 'tabs' }); TYPES.forEach(([t, l]) => tabs.append(h('button', { class: 'tab' + (B.type === t ? ' active' : ''), onclick: () => { B.type = t; B.offset = 0; S.params = {}; render(); } }, l)));
  [['modrinth', 'Modrinth'], ['curseforge', 'CurseForge']].forEach(([s, l]) => tabs.append(h('button', { class: 'tab' + (B.source === s ? ' active' : ''), onclick: () => { B.source = s; B.offset = 0; render(); } }, '● ' + l)));
  const q = h('input', { value: B.query, placeholder: 'Search…', class: 'grow' });
  const sort = h('select', null, [['follows', 'Recommended'], ['downloads', 'Most downloaded'], ['updated', 'Recently updated'], ['newest', 'Newest'], ['relevance', 'Best match']].map(([k, l]) => h('option', { value: k }, l))); sort.value = B.sort;
  const any = h('input', { type: 'checkbox' }); any.checked = B.anyVersion;
  const results = h('div', { class: 'grid' }); const info = h('p', { class: 'mute small' }); const more = h('button', { class: 'btn' }, 'Load more');
  const target = B.type === 'modpack' ? h('span', { class: 'chip' }, 'Modpacks create a new profile') : instSelect(B.instanceId, (id) => { B.instanceId = id; B.offset = 0; render(); });
  if (B.type === 'mod' && inst && inst.loader === 'vanilla') v.append(h('div', { class: 'warnbox' }, 'This profile is Vanilla. Mods need Fabric or Quilt. ', h('button', { class: 'btn', onclick: () => newProfileModal() }, 'Create Fabric profile')));
  v.append(tabs, h('div', { class: 'row' }, h('span', { class: 'mute' }, 'Install into'), target, h('label', null, any, ' any Minecraft version')), h('div', { class: 'row' }, q, sort, h('button', { class: 'btn primary', onclick: () => load(true) }, 'Search')), info, results, h('div', { class: 'row' }, more));
  let busy = false;
  async function load(reset) {
    if (reset) { B.offset = 0; results.textContent = ''; }
    B.query = q.value; B.sort = sort.value; B.anyVersion = any.checked;
    if (B.type !== 'modpack' && !inst) { info.textContent = 'Create a profile first (Versions → Create new profile).'; return; }
    info.textContent = 'Loading…'; more.disabled = true;
    try {
      const r = await api('contentSearch', B.source, B.type, { instanceId: B.type === 'modpack' ? null : B.instanceId, query: B.query, sort: B.sort, offset: B.offset, anyVersion: B.anyVersion });
      for (const p of r.hits) results.append(projectCard(p));
      B.offset += r.hits.length;
      const ctx = inst && B.type !== 'modpack' && !B.anyVersion ? ` for ${inst.mcVersion}${B.type === 'mod' ? ' • ' + inst.loader : ''}` : '';
      info.textContent = B.query ? `${r.total} results${ctx}` : `Recommended${ctx} • ${r.total} projects`; more.disabled = B.offset >= r.total || !r.hits.length;
    } catch (e) { info.textContent = ''; results.append(h('div', { class: 'panel' }, h('b', null, 'Could not load'), h('p', { class: 'mute' }, e.message), /API key/.test(e.message) ? h('button', { class: 'btn primary', onclick: () => go('set-cf') }, 'Open CurseForge settings') : h('button', { class: 'btn primary', onclick: () => go('set-net') }, 'Run network check'))); }
  }
  function projectCard(p) {
    const btn = h('button', { class: 'btn primary', onclick: async () => {
      if (busy) return; busy = true; btn.disabled = true; btn.textContent = 'Installing…';
      try {
        if (B.type === 'modpack') await installModpackFlow(p.source, p.id);
        else { if (!inst) throw new Error('Choose a profile first'); const r = await run(() => api('contentInstall', { instanceId: inst.id, source: p.source, projectId: p.id, type: B.type })); if (r) reportInstall(r); }
      } finally { busy = false; btn.disabled = false; btn.textContent = 'Install'; }
    } }, 'Install');
    return h('div', { class: 'card proj' }, icon(p.iconUrl, p.title), h('div', { class: 'info' }, h('b', null, p.title), h('span', { class: 'mute small' }, ' by ' + (p.author || '?')), h('div', { class: 'desc' }, p.description || ''),
      h('div', { class: 'row' }, h('span', { class: 'chip' }, '⬇ ' + fmtN(p.downloads)), h('span', { class: 'chip' }, p.source), btn, h('button', { class: 'btn', onclick: () => detailsModal(p, inst) }, 'Versions'))));
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(true); }); sort.addEventListener('change', () => load(true)); any.addEventListener('change', () => load(true)); more.addEventListener('click', () => load(false));
  load(true); return v;
}
async function detailsModal(p, inst) {
  const box = h('div', { class: 'log' }, 'Loading versions…'); box.style.height = '16rem';
  modal(p.title, h('div', null, h('p', { class: 'mute small' }, p.description || ''), box), (close) => [p.webUrl ? h('button', { class: 'btn', onclick: () => openLink(p.webUrl) }, 'Open website') : null, h('button', { class: 'btn primary', onclick: close }, 'Close')]);
  try {
    const vs = await api('contentVersions', p.source, p.id, p.type, p.type === 'modpack' || !inst ? undefined : inst.id);
    box.textContent = ''; box.className = ''; box.style.overflow = 'auto';
    if (!vs.length) box.append(h('p', { class: 'mute' }, 'No compatible versions for this profile.'));
    for (const v of vs.slice(0, 25)) box.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', null, v.name || v.number), h('div', { class: 'mute small' }, `${(v.mcVersions || []).slice(0, 4).join(', ')} • ${(v.loaders || []).join(', ')} • ${(v.datePublished || '').slice(0, 10)}`)),
      v.restricted ? h('button', { class: 'btn', onclick: () => openLink(v.webUrl) }, 'Restricted – open page') : h('button', { class: 'btn primary', onclick: async () => {
        if (p.type === 'modpack') { await installModpackFlow(p.source, p.id, v.id); return; }
        const r = await run(() => api('contentInstall', { instanceId: inst.id, source: p.source, projectId: p.id, versionId: v.id, type: p.type })); if (r) reportInstall(r);
      } }, 'Install')));
  } catch (e) { box.textContent = e.message; }
}

// ---------- Worlds ----------
S.worldsInst = null;
async function pageWorlds() {
  if (!S.worldsInst || !S.instances.some((i) => i.id === S.worldsInst)) S.worldsInst = S.selected || S.instances[0]?.id || null;
  const v = h('div', null);
  if (!S.worldsInst) { v.append(h('div', { class: 'panel' }, 'Create a profile first.')); return v; }
  const id = S.worldsInst;
  v.append(h('div', { class: 'panel row' }, h('span', { class: 'mute' }, 'Profile'), instSelect(id, (x) => { S.worldsInst = x; render(); }),
    h('button', { class: 'btn', onclick: async () => { const f = await window.shoaib.pickFile({ title: 'Import world (.zip)', filters: [{ name: 'World zip', extensions: ['zip'] }] }); if (f) { const r = await run(() => api('worldsImportZip', id, f)); if (r) { toast('World imported'); render(); } } } }, 'Import world (.zip)'),
    h('button', { class: 'btn', onclick: () => run(() => window.shoaib.openInstanceFolder(id, 'saves')) }, 'Open saves folder')));
  const data = await api('worldsList', id); const list = h('div', { class: 'panel' });
  if (!data.worlds.length) list.append(h('p', { class: 'mute' }, 'No worlds yet. Launch the game and create one, or import a world ZIP.'));
  for (const w of data.worlds) {
    list.append(h('div', { class: 'item' }, ico('globe'), h('div', { class: 'grow' }, h('b', null, w.name), h('div', { class: 'mute small' }, `${w.folder} • ${w.gameMode || '—'}${w.hardcore ? ' • Hardcore' : ''} • ${w.version || ''} • ${fmtB(w.sizeBytes)} • ${new Date(w.lastPlayed).toLocaleString()}`)),
      h('button', { class: 'btn', onclick: async () => { const r = await run(() => api('worldsBackup', id, w.folder)); if (r) { toast('Backup saved: ' + r.backup); render(); } } }, 'Backup'),
      h('button', { class: 'trash', title: 'Delete', onclick: () => modal('Delete world?', h('p', { class: 'mute' }, `"${w.name}" will be permanently deleted. Make a backup first if unsure.`), (close) => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn danger', onclick: async () => { close(); await run(() => api('worldsDelete', id, w.folder)); render(); } }, 'Delete')]) }, ico('trash'))));
  }
  v.append(list, h('p', { class: 'mute small' }, `${data.backups.length} backup(s) in the profile's backups folder. `, h('button', { class: 'btn', onclick: () => run(() => window.shoaib.openInstanceFolder(id, 'backups')) }, 'Open backups')));
  return v;
}

// ---------- Controls hub ----------
function miniLayout(layout) {
  const box = h('div', { class: 'mini' });
  for (const b of layout.buttons) { const el = h('div', { class: `tb ${b.shape}${b.type === 'joystick' ? ' joy' : ''}` }, b.label || ''); el.style.left = b.x + '%'; el.style.top = b.y + '%'; el.style.width = b.w + '%'; el.style.height = b.h + '%'; box.append(el); }
  return box;
}
async function pageControls() {
  const t = await api('touchList'); const lay = t.layouts[t.active];
  const tile = (icn, title, desc, label, fn) => h('div', { class: 'card' }, ico(icn), h('h2', null, title), h('p', { class: 'mute small' }, desc), h('button', { class: 'btn primary', onclick: fn }, label));
  return h('div', null,
    h('div', { class: 'panel row' }, h('div', { class: 'grow' }, h('h1', null, 'Controls'), h('p', { class: 'mute' }, `Active touch layout: ${t.active}. Edit your on-screen buttons or set keyboard and mouse keys.`)), h('div', { class: 'grow' }, miniLayout(lay))),
    h('div', { class: 'cap' }, 'Choose what you want to adjust'),
    h('div', { class: 'grid' }, tile('pad', 'Touch layout', 'Drag, resize and map on-screen buttons. Save several layouts and choose the active one.', 'Edit', () => go('touch-edit', { name: t.active })), tile('key', 'Keyboard & mouse', 'Set key bindings per profile. Saved into the profile\'s options.txt.', 'Open', () => go('keybinds'))));
}

// ---------- Touch layout editor ----------
const KEY_CHOICES = [['Jump', 'key.keyboard.space'], ['Sneak', 'key.keyboard.left.shift'], ['Sprint', 'key.keyboard.left.control'], ['Attack', 'key.mouse.left'], ['Use / Place', 'key.mouse.right'], ['Pick block', 'key.mouse.middle'], ['Inventory', 'key.keyboard.e'], ['Drop', 'key.keyboard.q'], ['Swap hands', 'key.keyboard.f'], ['Chat', 'key.keyboard.t'], ['Command', 'key.keyboard.slash'], ['Player list', 'key.keyboard.tab'], ['Escape', 'key.keyboard.escape'], ['Perspective', 'key.keyboard.f5'], ['Screenshot', 'key.keyboard.f2'], ['Forward', 'key.keyboard.w'], ['Left', 'key.keyboard.a'], ['Back', 'key.keyboard.s'], ['Right', 'key.keyboard.d'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`Hotbar ${n}`, `key.keyboard.${n}`])];
async function pageTouchEdit(params) {
  const t = await api('touchList'); let name = params.name && t.layouts[params.name] ? params.name : t.active;
  let layout = JSON.parse(JSON.stringify(t.layouts[name])); let sel = null; let dirty = false;
  const canvas = h('div', { class: 'canvas' }); const side = h('div', { class: 'panel' });
  const place = (el, b) => { el.style.left = b.x + '%'; el.style.top = b.y + '%'; el.style.width = b.w + '%'; el.style.height = b.h + '%'; };
  function draw() {
    canvas.textContent = '';
    for (const b of layout.buttons) {
      const el = h('div', { class: `tb ${b.shape}${b.type === 'joystick' ? ' joy' : ''}${sel === b.id ? ' sel' : ''}` }, b.label || ''); place(el, b);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); sel = b.id; const r = canvas.getBoundingClientRect(); const sx = e.clientX, sy = e.clientY, ox = b.x, oy = b.y;
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
        const mv = (m) => { b.x = Math.max(0, Math.min(100 - b.w, ox + ((m.clientX - sx) / r.width) * 100)); b.y = Math.max(0, Math.min(100 - b.h, oy + ((m.clientY - sy) / r.height) * 100)); place(el, b); dirty = true; };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); drawSide(); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      });
      canvas.append(el);
    }
    drawSide();
  }
  function drawSide() {
    side.textContent = '';
    const b = layout.buttons.find((x) => x.id === sel);
    side.append(h('h2', null, b ? `Button: ${b.label || b.id}` : 'Select a button on the screen above'));
    if (b) {
      const lab = h('input', { value: b.label, maxlength: 8 }); lab.addEventListener('input', () => { b.label = lab.value; dirty = true; draw(); });
      const w = h('input', { type: 'range', min: 4, max: b.type === 'look' ? 60 : 30, step: 1, value: b.w }); w.addEventListener('input', () => { b.w = Number(w.value); b.x = Math.min(b.x, 100 - b.w); dirty = true; draw(); });
      const hh = h('input', { type: 'range', min: 4, max: b.type === 'look' ? 80 : 40, step: 1, value: b.h }); hh.addEventListener('input', () => { b.h = Number(hh.value); b.y = Math.min(b.y, 100 - b.h); dirty = true; draw(); });
      side.append(h('div', { class: 'row' }, h('div', null, h('label', null, 'Label'), lab), h('div', null, h('label', null, 'Width'), w), h('div', null, h('label', null, 'Height'), hh)));
      if (b.type === 'key') {
        const ks = h('select', null, KEY_CHOICES.map(([l, k]) => h('option', { value: k }, l))); ks.value = b.key; ks.addEventListener('change', () => { b.key = ks.value; const c = KEY_CHOICES.find((x) => x[1] === ks.value); if (c && (!b.label || b.label.length > 0)) { b.label = c[0].slice(0, 6).toUpperCase(); } dirty = true; draw(); });
        const sh = h('select', null, ['round', 'pill', 'square'].map((s) => h('option', { value: s }, s))); sh.value = b.shape; sh.addEventListener('change', () => { b.shape = sh.value; dirty = true; draw(); });
        side.append(h('div', { class: 'row' }, h('div', null, h('label', null, 'Action'), ks), h('div', null, h('label', null, 'Shape'), sh)));
      } else side.append(h('p', { class: 'mute small' }, b.type === 'joystick' ? 'Joystick: walks with W A S D (drag inside the circle).' : 'Look area: drag here to turn the camera.'));
      side.append(h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => { layout.buttons = layout.buttons.filter((x) => x.id !== b.id); sel = null; dirty = true; draw(); } }, 'Delete button')));
    }
    const add = h('select', null, h('option', { value: '' }, '+ Add button…'), KEY_CHOICES.map(([l, k]) => h('option', { value: k }, l)), h('option', { value: '__joy' }, 'Joystick (W A S D)'), h('option', { value: '__look' }, 'Look area'));
    add.addEventListener('change', () => {
      if (!add.value) return; const id = 'b' + Date.now().toString(36);
      if (add.value === '__joy') { if (layout.buttons.some((x) => x.type === 'joystick')) return toast('Only one joystick', true); layout.buttons.push({ id, type: 'joystick', label: 'Move', keys: { up: 'key.keyboard.w', left: 'key.keyboard.a', down: 'key.keyboard.s', right: 'key.keyboard.d' }, x: 4, y: 52, w: 22, h: 40, shape: 'round' }); }
      else if (add.value === '__look') { if (layout.buttons.some((x) => x.type === 'look')) return toast('Only one look area', true); layout.buttons.push({ id, type: 'look', label: 'Look', x: 40, y: 12, w: 38, h: 50, shape: 'area' }); }
      else { const c = KEY_CHOICES.find((x) => x[1] === add.value); layout.buttons.push({ id, type: 'key', label: c[0].slice(0, 6).toUpperCase(), key: add.value, x: 45, y: 40, w: 9, h: 14, shape: 'round' }); }
      sel = id; dirty = true; draw();
    });
    const nm = h('input', { value: name === 'Default' ? 'My layout' : name, maxlength: 30 });
    const pick = h('select', null, t.names.map((n) => h('option', { value: n }, n + (n === t.active ? ' (active)' : '')))); pick.value = name;
    pick.addEventListener('change', () => go2(pick.value));
    side.append(h('div', { class: 'row' }, add), h('div', { class: 'cap' }, 'Layouts'), h('div', { class: 'row' }, pick, nm,
      h('button', { class: 'btn primary', onclick: async () => { const r = await run(() => api('touchSave', nm.value, layout)); if (r) { dirty = false; name = nm.value.trim(); toast('Layout saved'); go2(name); } } }, 'Save'),
      h('button', { class: 'btn', onclick: async () => { const r = await run(() => api('touchSetActive', name)); if (r) { toast(`"${name}" is now active`); go2(name); } } }, 'Set active'),
      h('button', { class: 'btn', onclick: () => { layout = JSON.parse(JSON.stringify(t.layouts.Default)); sel = null; dirty = true; draw(); } }, 'Reset to default'),
      name !== 'Default' ? h('button', { class: 'btn danger', onclick: async () => { const r = await run(() => api('touchDelete', name)); if (r) { toast('Layout deleted'); go2('Default'); } } }, 'Delete layout') : null),
      h('p', { class: 'mute small' }, 'Layouts are stored in the launcher. Sending these touches into the running game is an experimental runtime step (not included yet).'));
  }
  const go2 = (n) => { S.params = { name: n }; render(); };
  draw();
  return h('div', null, canvas, side);
}

// ---------- Key bindings ----------
const CODE_MAP = { Space: 'space', ShiftLeft: 'left.shift', ShiftRight: 'right.shift', ControlLeft: 'left.control', ControlRight: 'right.control', AltLeft: 'left.alt', AltRight: 'right.alt', Tab: 'tab', Enter: 'enter', Backspace: 'backspace', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Slash: 'slash', Backquote: 'grave.accent', Minus: 'minus', Equal: 'equal', Comma: 'comma', Period: 'period', Semicolon: 'semicolon', Quote: 'apostrophe', BracketLeft: 'left.bracket', BracketRight: 'right.bracket', Backslash: 'backslash', CapsLock: 'caps.lock', Insert: 'insert', Delete: 'delete', Home: 'home', End: 'end', PageUp: 'page.up', PageDown: 'page.down' };
function mcKeyFromEvent(e) {
  const c = e.code; let n = CODE_MAP[c];
  if (!n && /^Key[A-Z]$/.test(c)) n = c[3].toLowerCase();
  if (!n && /^Digit\d$/.test(c)) n = c[5];
  if (!n && /^F\d{1,2}$/.test(c)) n = c.toLowerCase();
  if (!n && /^Numpad\d$/.test(c)) return 'key.keyboard.keypad.' + c[6];
  return n ? 'key.keyboard.' + n : null;
}
const mouseName = (b) => ['left', 'right', 'middle'][b] || String(b + 1);
const prettyKey = (k) => (k === 'key.keyboard.unknown' ? 'Not bound' : k.replace('key.keyboard.', '').replace('key.mouse.', 'Mouse ').replace(/\./g, ' ').toUpperCase());
S.ctlInst = null;
async function pageKeybinds() {
  if (!S.ctlInst || !S.instances.some((i) => i.id === S.ctlInst)) S.ctlInst = S.selected || S.instances[0]?.id || null;
  const v = h('div', null);
  if (!S.ctlInst) { v.append(h('div', { class: 'panel' }, 'Create a profile first.')); return v; }
  const id = S.ctlInst; const c = await api('controlsGet', id);
  v.append(h('div', { class: 'panel row' }, h('span', { class: 'mute' }, 'Profile'), instSelect(id, (x) => { S.ctlInst = x; render(); })));
  if (!c.supported) { v.append(h('div', { class: 'warnbox' }, c.reason)); return v; }
  const changed = {}; const optChanged = {};
  const tbl = h('div', { class: 'panel' }, h('h2', null, 'Key bindings'), h('p', { class: 'mute small' }, 'Tap a binding, then press a key or mouse button. Esc cancels.'));
  for (const k of c.keys) {
    const btn = h('button', { class: 'btn keybtn' }, prettyKey(k.value));
    const setVal = (val) => { changed[k.id] = val; btn.textContent = prettyKey(val) + ' *'; };
    btn.addEventListener('click', () => {
      btn.classList.add('listening'); btn.textContent = 'Press a key…';
      const done = () => { btn.classList.remove('listening'); document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onMouse, true); };
      const onKey = (e) => { e.preventDefault(); e.stopPropagation(); done(); if (e.code === 'Escape') { btn.textContent = prettyKey(changed[k.id] || k.value); return; } const mk = mcKeyFromEvent(e); if (mk) setVal(mk); else { btn.textContent = prettyKey(changed[k.id] || k.value); toast('That key is not supported', true); } };
      const onMouse = (e) => { if (e.target === btn && !btn.classList.contains('listening')) return; e.preventDefault(); e.stopPropagation(); done(); setVal('key.mouse.' + mouseName(e.button)); };
      setTimeout(() => { document.addEventListener('keydown', onKey, true); document.addEventListener('mousedown', onMouse, true); }, 0);
    });
    tbl.append(h('div', { class: 'item' }, h('div', { class: 'grow' }, k.label), btn, h('button', { class: 'btn', onclick: () => setVal(k.def) }, 'Default')));
  }
  const sens = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: c.options.mouseSensitivity }); const sensLbl = h('span', { class: 'mute' }, Math.round(c.options.mouseSensitivity * 200) + '%');
  sens.addEventListener('input', () => { optChanged.mouseSensitivity = Number(sens.value); sensLbl.textContent = Math.round(sens.value * 200) + '%'; });
  const chk = (key, label) => { const x = h('input', { type: 'checkbox' }); x.checked = !!c.options[key]; x.addEventListener('change', () => { optChanged[key] = x.checked; }); return h('label', null, x, ' ' + label); };
  v.append(tbl, h('div', { class: 'panel' }, h('h2', null, 'Mouse & movement'), h('div', { class: 'row' }, h('span', null, 'Mouse sensitivity'), sens, sensLbl), h('div', { class: 'row' }, chk('invertYMouse', 'Invert mouse'), chk('autoJump', 'Auto-jump'), chk('toggleSprint', 'Toggle sprint'), chk('toggleCrouch', 'Toggle sneak'), chk('rawMouseInput', 'Raw mouse input'))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { if (!Object.keys(changed).length && !Object.keys(optChanged).length) return toast('Nothing changed'); const r = await run(() => api('controlsSet', id, { keys: changed, options: optChanged })); if (r) { toast('Controls saved'); render(); } } }, 'Save controls'),
      h('button', { class: 'btn danger', onclick: async () => { const r = await run(() => api('controlsReset', id)); if (r) { toast('Controls reset to default'); render(); } } }, 'Reset all keys')));
  return v;
}

// ---------- Settings ----------
function srow(icn, title, desc, fn, cls) { return h('button', { class: 'srow' + (cls ? ' ' + cls : ''), onclick: fn }, h('div', { class: 'ic' }, ico(icn)), h('div', null, h('b', null, title), h('span', { class: 'd' }, desc))); }
async function pageSettings() {
  return h('div', null, h('div', { class: 'cap' }, 'Categories'), h('div', { class: 'panel', style: undefined },
    srow('star', 'Shoaib+', 'Auto backups, download queue, smart settings and backup tools. Free and local.', () => go('plus'), 'amber'),
    srow('monitor', 'Video and renderer', 'Resolution, fullscreen and window behaviour.', () => go('set-video')),
    srow('cpu', 'Performance', 'RAM allocation and JVM arguments.', () => go('set-perf')),
    srow('pad', 'Control customization', 'Touch layouts and key bindings.', () => go('controls')),
    srow('java', 'Java runtimes', 'Detected Java versions and a custom executable.', () => go('java')),
    srow('folder', 'Storage', 'Where game data is kept: phone, SD card or external drive.', () => go('set-storage')),
    srow('globe', 'Network check', 'Test Modrinth, CurseForge, Mojang and Java downloads and see what is blocked.', () => go('set-net')),
    srow('key', 'CurseForge', 'API key to browse and download from CurseForge.', () => go('set-cf')),
    srow('info', 'About', 'Shoaib Launcher V1 • Mod By Shoaib', () => go('about'))));
}
function saveBtn(collect, done) { return h('button', { class: 'btn primary', onclick: async () => { const r = await run(() => api('setSettings', collect())); if (r) { S.settings = r; toast('Saved'); if (done) done(); render(); } } }, 'Save'); }
async function pageSetVideo() {
  const s = S.settings; const w = h('input', { type: 'number', min: 0, value: s.width }), hh = h('input', { type: 'number', min: 0, value: s.height });
  const fs = h('input', { type: 'checkbox' }); fs.checked = s.fullscreen; const hide = h('input', { type: 'checkbox' }); hide.checked = s.hideOnLaunch;
  return h('div', { class: 'panel' }, h('h2', null, 'Game window'), h('div', { class: 'row' }, h('div', null, h('label', null, 'Width (0 = default)'), w), h('div', null, h('label', null, 'Height (0 = default)'), hh)),
    h('label', null, fs, ' Fullscreen'), h('label', null, hide, ' Minimize launcher while the game runs'), h('div', { class: 'row' }, saveBtn(() => ({ width: w.value, height: hh.value, fullscreen: fs.checked, hideOnLaunch: hide.checked }))));
}
async function pagePerf() {
  const s = S.settings; const a = h('input', { type: 'number', min: 256, step: 256, value: s.ramMin }), b = h('input', { type: 'number', min: 256, step: 256, value: s.ramMax }), j = h('input', { value: s.jvmArgs, placeholder: '-XX:+UseG1GC', class: 'grow' });
  const warn = h('div'); (s.warnings || []).forEach((x) => warn.append(h('div', { class: 'warnbox' }, x)));
  return h('div', { class: 'panel' }, h('h2', null, 'RAM and JVM'), h('p', { class: 'mute small' }, `System memory: ${s.systemRamMB} MB. Do not give the game all of it.`), h('div', { class: 'row' }, h('div', null, h('label', null, 'Min RAM (MB)'), a), h('div', null, h('label', null, 'Max RAM (MB)'), b)), warn,
    h('label', null, 'Extra JVM arguments'), h('div', { class: 'row' }, j), h('div', { class: 'row' }, saveBtn(() => ({ ramMin: a.value, ramMax: b.value, jvmArgs: j.value })), h('button', { class: 'btn danger', onclick: async () => { S.settings = await api('resetSettings'); toast('Settings reset'); render(); } }, 'Reset all settings')));
}
async function pageJava() {
  const v = h('div', null, h('p', { class: 'mute' }, 'The right Java is chosen per Minecraft version. If none is found it is downloaded from Adoptium (checksum verified) when you download a version.'));
  const list = h('div', { class: 'panel' }, h('h2', null, 'Detected runtimes'), h('p', { class: 'mute' }, 'Scanning…')); v.append(list);
  const jp = h('input', { value: S.settings.javaPath, placeholder: 'automatic', class: 'grow' });
  v.append(h('div', { class: 'panel' }, h('h2', null, 'Custom Java executable (all profiles)'), h('div', { class: 'row' }, jp, h('button', { class: 'btn', onclick: async () => { const p = await window.shoaib.pickJava(); if (p) jp.value = p; } }, 'Browse'), saveBtn(() => ({ javaPath: jp.value }))), h('p', { class: 'mute small' }, 'An incompatible Java shows a warning when launching.')));
  api('detectJava').then((js) => { list.textContent = ''; list.append(h('h2', null, 'Detected runtimes')); if (!js.length) list.append(h('p', { class: 'mute' }, 'No Java found yet. It is installed automatically with your first version download.')); js.forEach((j) => list.append(h('div', { class: 'row' }, h('b', null, 'Java ' + j.major), h('span', { class: 'mute small grow' }, j.path), h('span', { class: 'chip' }, j.version)))); }).catch((e) => toast(e.message, true));
  return v;
}
async function pageStorage() {
  const st = await api('getStorage'); const move = h('input', { type: 'checkbox' }); move.checked = true; const target = h('input', { placeholder: 'Folder path (external drive, SD card or phone storage)', class: 'grow' });
  return h('div', { class: 'panel' }, h('h2', null, 'Storage location'), h('p', { class: 'mute small' }, `Game data (versions, profiles, worlds, mods) is stored in: ${st.root}`),
    h('p', { class: 'mute small' }, `Free space: ${st.freeBytes != null ? fmtB(st.freeBytes) : 'unknown'}. Java runtimes always stay on internal storage (${st.runtimes}) because SD/FAT storage cannot run programs.`),
    st.envOverride ? h('div', { class: 'warnbox' }, 'Location is forced by the SHOAIB_HOME environment variable.') : null,
    h('div', { class: 'row' }, target, h('button', { class: 'btn', onclick: async () => { const p = await window.shoaib.pickFolder(); if (p) target.value = p; } }, 'Browse')),
    h('label', null, move, ' Move existing data to the new location (recommended)'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { if (!target.value.trim()) return toast('Choose a folder', true); toast('Working… do not close the launcher'); const r = await run(() => api('setStorage', target.value.trim(), { move: move.checked })); if (r) modal('Restart needed', h('p', { class: 'mute' }, 'Storage location changed. Restart the launcher to use ' + r.root), (close) => [h('button', { class: 'btn', onclick: close }, 'Later'), h('button', { class: 'btn primary', onclick: () => window.shoaib.relaunch() }, 'Restart now')]); } }, 'Apply location'),
      st.custom ? h('button', { class: 'btn', onclick: async () => { await run(() => api('resetStorage')); toast('Reset. Restart to apply.'); } }, 'Use default location') : null));
}
async function pageCF() {
  const s = S.settings; const cf = h('input', { type: 'password', placeholder: s.curseforgeKeySet ? 'Key saved (hidden). Paste a new one to replace.' : 'Paste your CurseForge API key', class: 'grow' });
  return h('div', { class: 'panel' }, h('h2', null, 'CurseForge API key'), h('p', { class: 'mute small' }, 'CurseForge only allows launchers that use their own API key. Get a free key at console.curseforge.com and paste it here. Modrinth needs no key.'),
    h('div', { class: 'row' }, cf, h('button', { class: 'btn primary', onclick: async () => { if (!cf.value.trim()) return toast('Paste a key first', true); const r = await run(() => api('setSettings', { curseforgeKey: cf.value })); if (r) { S.settings = r; toast('CurseForge key saved'); render(); } } }, 'Save key'),
      s.curseforgeKeySet ? h('button', { class: 'btn danger', onclick: async () => { S.settings = await api('setSettings', { curseforgeKey: null }); toast('Key removed'); render(); } }, 'Remove') : null));
}
async function pageNet() {
  const box = h('div', { class: 'panel' }); const btn = h('button', { class: 'btn primary' }, 'Run test');
  async function runTest() {
    btn.disabled = true; btn.textContent = 'Testing…'; box.textContent = ''; box.append(h('p', { class: 'mute' }, 'Checking each service (up to 10 seconds each)…'));
    const res = await run(() => api('contentDiagnose')); btn.disabled = false; btn.textContent = 'Run test again'; if (!res) return;
    box.textContent = '';
    for (const r of res) box.append(h('div', { class: 'item' }, h('span', { class: 'chip ' + (r.ok === true ? 'ok' : r.ok === false ? 'warn' : '') }, r.ok === true ? 'OK' : r.ok === false ? 'FAILED' : 'INFO'),
      h('div', { class: 'grow' }, h('b', null, r.name), h('div', { class: 'mute small' }, r.ok === true ? `Reachable • ${r.ms} ms` : r.ok === null ? r.note : r.error), r.hint ? h('div', { class: 'small' }, r.hint) : null)));
    const bad = res.filter((r) => r.ok === false);
    if (!bad.length) box.append(h('p', { class: 'mute small' }, 'Everything reachable. If a list is still empty, send the exact message shown on the Browse page.'));
  }
  btn.addEventListener('click', runTest); runTest();
  return h('div', null, h('p', { class: 'mute' }, 'Use this when mods, modpacks, versions or Java do not load. It shows exactly which service cannot be reached and why.'), h('div', { class: 'row' }, btn), box);
}
function pageAbout() { return h('div', { class: 'panel' }, h('div', { class: 'hero' }, h('img', { src: '../assets/icon.png', width: 96, height: 96, alt: '' }), h('div', null, h('div', { class: 'big' }, 'Shoaib Launcher V1'), h('div', { class: 'mute' }, 'Developer: Mod By Shoaib'), h('p', { class: 'mute small' }, 'Minecraft is a trademark of Mojang/Microsoft. This launcher is not affiliated with them.')))); }

// ---------- Shoaib+ ----------
S.plusInst = null; S.plusQueue = null;
async function pagePlus() {
  if (!S.plusInst || !S.instances.some((i) => i.id === S.plusInst)) S.plusInst = S.selected || S.instances[0]?.id || null;
  const s = S.settings; const rec = await api('plusRecommend'); const q = S.plusQueue && S.plusQueue.state === 'running' ? S.plusQueue : null;
  const card = (icn, title, desc, ...body) => h('div', { class: 'card pcard' }, h('div', { class: 'row' }, h('div', { class: 'lic gold' }, ico(icn)), h('div', { class: 'grow' }, h('h2', null, title), h('div', { class: 'mute small' }, desc))), ...body);
  const needInst = (fn) => async () => { if (!S.plusInst) return toast('Create a profile first', true); await fn(S.plusInst); };
  const v = h('div', null, h('div', { class: 'panel plushead' }, h('div', { class: 'lic gold big' }, ico('star')), h('div', null, h('h1', { class: 'gold' }, 'Shoaib+'), h('div', { class: 'mute' }, 'Free power tools that run on your device. No account, no payment, nothing is uploaded.'))));
  v.append(h('div', { class: 'row' }, h('span', { class: 'mute' }, 'Profile'), instSelect(S.plusInst, (id) => { S.plusInst = id; render(); })));
  const auto = h('input', { type: 'checkbox' }); auto.checked = s.plusAutoBackup; const keep = h('input', { type: 'number', min: 1, max: 20, value: s.plusBackupKeep });
  const queueBox = h('div'); const pending = S.instances.filter((i) => !i.installed); const picks = [];
  for (const i of pending) { const c = h('input', { type: 'checkbox' }); c.checked = true; picks.push([i.id, c]); queueBox.append(h('label', null, c, ` ${i.name} (${loaderName(i.loader)} ${verId(i)})`)); }
  if (!pending.length) queueBox.append(h('p', { class: 'mute small' }, 'Every profile is already downloaded.'));
  const grid = h('div', { class: 'grid' },
    card('shield', 'Auto world backups', 'After the game closes, worlds you played are copied to the profile\'s backups folder. Oldest copies are removed.',
      h('label', null, auto, ' Back up automatically when the game closes'), h('div', { class: 'row' }, h('span', { class: 'mute small' }, 'Keep per world'), keep,
        h('button', { class: 'btn primary', onclick: async () => { const r = await run(() => api('setSettings', { plusAutoBackup: auto.checked, plusBackupKeep: keep.value })); if (r) { S.settings = r; toast('Saved'); } } }, 'Save')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: needInst(async (id) => { toast('Backing up…'); const r = await run(() => api('plusBackupWorlds', id)); if (r) toast(r.created.length ? `Backed up ${r.created.length} world(s)` : 'No worlds to back up'); }) }, 'Back up all worlds now'))),
    card('zap', 'Smart settings', rec.reason,
      h('p', null, h('b', null, `${rec.ramMin}–${rec.ramMax} MB`), ' RAM • ', h('span', { class: 'mute small' }, rec.jvmArgs)), h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { const r = await run(() => api('plusApplyRecommended')); if (r) { S.settings = r; toast('Recommended settings applied'); render(); } } }, 'Apply'))),
    card('queue', 'Download queue', 'Pick several profiles and download them one after another.', queueBox,
      q ? h('p', { class: 'mute small' }, `Downloading ${q.index + 1} of ${q.total}…`) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !!q || !pending.length || !!S.install, onclick: async () => { const ids = picks.filter(([, c]) => c.checked).map(([id]) => id); if (!ids.length) return toast('Choose a profile', true); const r = await run(() => api('plusQueueInstalls', ids)); if (r) { toast('Queue started'); S.stack = []; S.page = 'home'; render(); } } }, 'Start queue'), q ? h('button', { class: 'btn danger', onclick: () => run(() => api('plusQueueCancel')) }, 'Cancel') : null)),
    card('folder', 'Backup to folder', 'Copy a whole profile (worlds, mods, settings) to any folder, such as a Dropbox, Drive or Syncthing folder or an SD card, and restore it later.',
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: needInst(async (id) => { const d = await window.shoaib.pickFolder(); if (!d) return; toast('Copying… this can take a while'); const r = await run(() => api('plusBackupProfile', id, d)); if (r) toast('Saved to ' + r.path); }) }, 'Backup profile…'),
        h('button', { class: 'btn', onclick: async () => { const d = await window.shoaib.pickFolder(); if (!d) return; toast('Restoring…'); const r = await run(() => api('plusRestoreProfile', d)); if (r) { await refresh(); toast(`Restored as "${r.name}"`); render(); } } }, 'Restore profile…'))),
    card('book', 'Launcher backup file', 'Save your settings, profile list, touch layouts and local accounts in one small file. Worlds and mods are not included (use Backup to folder).',
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { const f = await window.shoaib.pickSave({ defaultPath: 'shoaib-launcher-backup.json', filters: [{ name: 'Backup', extensions: ['json'] }] }); if (!f) return; const r = await run(() => api('plusExportBackup', f)); if (r) { toast(`Saved: ${r.instances} profiles, ${r.layouts} layouts, ${r.accounts} accounts`); window.shoaib.afterSave(f); } } }, 'Export'),
        h('button', { class: 'btn', onclick: async () => { const f = await window.shoaib.pickFile({ title: 'Import backup', filters: [{ name: 'Backup', extensions: ['json'] }] }); if (!f) return; const r = await run(() => api('plusImportBackup', f)); if (r) { await refresh(); toast(`Imported: ${r.instances} profiles, ${r.layouts} layouts, ${r.accounts} accounts`); render(); } } }, 'Import'))),
    card('cloud', 'Cloud sync', 'Not available: it needs an online Shoaib server that does not exist yet. Until then, use Backup to folder with a folder that your cloud app already syncs.', h('button', { class: 'btn', disabled: true }, 'Not available')));
  v.append(grid); return v;
}

// ---------- shell ----------
const PAGES = { home: pageHome, profiles: pageProfiles, library: pageLibrary, browse: pageBrowse, worlds: pageWorlds, controls: pageControls, 'touch-edit': pageTouchEdit, keybinds: pageKeybinds, settings: pageSettings, plus: pagePlus, 'set-video': pageSetVideo, 'set-perf': pagePerf, java: pageJava, 'set-storage': pageStorage, 'set-cf': pageCF, 'set-net': pageNet, about: pageAbout };
let renderToken = 0;
async function render() {
  const token = ++renderToken; renderTopbar(); renderPop();
  const view = byId('view'); let node; let done = false;
  setTimeout(() => { if (!done && token === renderToken) { view.textContent = ''; view.append(h('div', { class: 'skel' }), h('div', { class: 'skel s2' })); } }, 140);
  try { node = await PAGES[S.page](S.params); } catch (e) { node = h('div', { class: 'panel' }, 'Error: ' + e.message); }
  done = true;
  if (token !== renderToken) return;
  view.textContent = ''; view.append(node); view.scrollTop = 0;
  const lg = byId('log'); if (lg) lg.scrollTop = lg.scrollHeight;
}
window.shoaib.onEvent((name, p) => {
  if (name === 'plus-queue') { S.plusQueue = p; if (S.page === 'plus') render(); if (p.state !== 'running') toast(p.state === 'done' ? (p.failed && p.failed.length ? `Queue finished, ${p.failed.length} failed` : 'All downloads finished') : 'Queue cancelled', p.failed && p.failed.length); if (p.state !== 'running') refresh().then(render); return; }
  if (name === 'plus-backup') { toast('Auto-backup saved: ' + p.created.join(', ')); return; }
  if (name === 'content-progress') { const el = byId('dl-status'); if (el) el.textContent = p.doneBytes >= p.size && p.size ? '' : `Downloading ${p.name}… ${fmtB(p.doneBytes)}`; return; }
  if (name === 'install-progress' && !S.install) S.install = { instanceId: p.instanceId, percent: 0, stage: p.stage };
  if (name === 'install-progress' && S.install) { Object.assign(S.install, p); if (S.page === 'home') render(); }
  else if (name === 'install-stage' && S.install) { S.install.stage = p.stage; }
  else if (name === 'install-state' && S.install) { S.install.paused = p.state === 'paused'; if (S.page === 'home') render(); }
  else if (name === 'install-done') { S.install = null; if (p.ok) toast('Download complete. You can play now!'); else if (!p.cancelled) toast('Download failed: ' + p.error, true); else toast('Download cancelled'); refresh().then(render); }
  else if (name === 'game-log') { S.logs.push(p.text); if (S.logs.length > 400) S.logs.splice(0, 100); const lg = byId('log'); if (lg) { lg.textContent = S.logs.join(''); lg.scrollTop = lg.scrollHeight; } }
  else if (name === 'game-state') { refresh().then(render); }
  else if (name === 'game-exit') { if (p.crashed) toast(`Game crashed or exited with code ${p.code}.${p.crashReport ? ' Crash report saved in the profile folder.' : ''}${p.error ? ' ' + p.error : ''}`, true); else toast('Game closed'); refresh().then(render); }
});
(function bindWin() {
  const w = window.shoaib; if (!w.winControl) { const tb = byId('titlebar'); if (tb) tb.style.display = 'none'; return; }
  byId('wb-min').addEventListener('click', () => w.winControl('min')); byId('wb-max').addEventListener('click', () => w.winControl('max')); byId('wb-close').addEventListener('click', () => w.winControl('close'));
  w.onWinState((m) => { byId('wb-max').innerHTML = m ? '&#10064;' : '&#9633;'; });
})();
refresh().then(render).catch((e) => { byId('view').textContent = 'Failed to start: ' + e.message; });
