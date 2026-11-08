'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const V = require('./versions');
const java = require('./java');
const { isAndroid } = require('./paths');
const log = require('./logger');

const LAUNCHER_NAME = 'ShoaibLauncher';
const LAUNCHER_VERSION = '1.0.0';

function substitute(str, vars) { return str.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)); }
function collect(list, features) {
  const out = [];
  for (const e of list || []) {
    if (typeof e === 'string') { out.push(e); continue; }
    if (!V.rulesAllow(e.rules, features)) continue;
    if (Array.isArray(e.value)) out.push(...e.value); else if (e.value != null) out.push(e.value);
  }
  return out;
}
function dedupeLibs(libs) {
  const seen = new Set(); const out = [];
  for (const l of libs) {
    const parts = l.name.split('@')[0].split(':');
    const key = `${parts[0]}:${parts[1]}:${parts[3] || ''}`;
    if (seen.has(key)) continue; seen.add(key); out.push(l);
  }
  return out;
}

/**
 * Build the exact java command for an installed version. Throws on hard problems, returns warnings for soft ones.
 * opts: { d, versionId, account, javaPath, gameDir, ramMin, ramMax, jvmArgs[], width, height, fullscreen, urls }
 */
async function prepareLaunch(opts) {
  const { d, versionId, account } = opts;
  const warnings = [];
  if (!account) throw new Error('No account selected. Add an offline profile or log in first.');
  if (!V.isInstalled(d, versionId)) throw new Error(`Version ${versionId} is not installed (or verification failed). Install it first.`);
  if (isAndroid()) throw new Error('Playing is not possible here: Minecraft needs desktop native libraries that Android/Termux cannot load. Downloading and managing works. To play, use a desktop PC or an Android launcher that ships its own runtime.');
  const json = await V.resolveVersion(d, versionId, { urls: opts.urls });
  const gameDir = path.resolve(opts.gameDir || path.join(d.instances, 'default'));
  fs.mkdirSync(gameDir, { recursive: true });

  const required = json.javaVersion?.majorVersion || 8;
  let javaPath = opts.javaPath;
  if (javaPath) {
    const info = await java.probe(javaPath);
    if (!info) throw new Error(`Selected Java is not runnable: ${javaPath}`);
    if (!java.isCompatible(info.major, required)) warnings.push(`Java ${info.major} selected but this version needs Java ${required}${required <= 8 ? ' (exactly)' : '+'}. The game may crash.`);
  } else {
    const found = await java.findCompatible(d, required);
    if (!found) throw new Error(`No compatible Java ${required} found. Install it from the Java manager.`);
    javaPath = found.path;
  }

  const ramMin = opts.ramMin ?? 512, ramMax = opts.ramMax ?? 2048;
  if (ramMax < ramMin) throw new Error('Maximum RAM cannot be lower than minimum RAM');
  const totalMB = Math.floor(os.totalmem() / 1048576);
  if (ramMax > totalMB * 0.8) warnings.push(`Max RAM ${ramMax} MB is more than 80% of your system memory (${totalMB} MB). This can freeze your computer.`);
  if (ramMax < 1024) warnings.push('Max RAM under 1 GB may cause out-of-memory crashes.');

  const libs = V.resolveLibraries(json, d, opts.urls || V.URLS);
  if (process.platform === 'linux' && process.arch === 'arm64' && !libs.some((l) => /arm64|aarch64/.test(l.name))) warnings.push('No ARM64 native libraries were found for this Minecraft version, so it will probably not start on an ARM device (such as a phone). Newer versions usually include them: try a newer release.');
  const cpLibs = dedupeLibs(libs.filter((l) => !l.legacy));
  const jarFile = path.join(d.versions, json._jarId, `${json._jarId}.jar`);
  for (const f of [...cpLibs.map((l) => l.path), jarFile]) if (!fs.existsSync(f)) throw new Error(`Missing required file: ${f}. Re-install the version.`);
  const sep = process.platform === 'win32' ? ';' : ':';
  const classpath = [...cpLibs.map((l) => l.path), jarFile].join(sep);

  const nativesDir = path.join(d.versions, versionId, 'natives');
  const indexId = json.assetIndex.id;
  const index = JSON.parse(fs.readFileSync(path.join(d.assets, 'indexes', `${indexId}.json`), 'utf8'));
  let gameAssets = path.join(d.assets, 'virtual', indexId);
  if (index.map_to_resources) {
    gameAssets = path.join(gameDir, 'resources');
    for (const [name, o] of Object.entries(index.objects)) {
      const dst = path.join(gameAssets, name);
      if (!fs.existsSync(dst)) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(d.assets, 'objects', o.hash.slice(0, 2), o.hash), dst); }
    }
  }

  const features = { has_custom_resolution: !!(opts.width && opts.height), is_demo_user: false, has_quick_plays_support: false, is_quick_play_singleplayer: false, is_quick_play_multiplayer: false, is_quick_play_realms: false };
  const token = account.accessToken || '0';
  const vars = {
    auth_player_name: account.name, version_name: versionId, game_directory: gameDir, assets_root: d.assets, assets_index_name: indexId,
    auth_uuid: account.uuid, auth_access_token: token, auth_session: token, clientid: account.clientId || '', auth_xuid: account.xuid || '',
    user_type: account.type === 'microsoft' ? 'msa' : 'legacy', user_properties: '{}', version_type: json.type || 'release',
    resolution_width: opts.width || 854, resolution_height: opts.height || 480, natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME, launcher_version: LAUNCHER_VERSION, classpath, classpath_separator: sep, library_directory: d.libraries, game_assets: gameAssets,
  };
  if (account.accessToken) log.addSecret(account.accessToken);

  let jvm, game;
  if (json.arguments) {
    jvm = collect(json.arguments.jvm, features);
    game = collect(json.arguments.game, features);
  } else {
    jvm = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
    game = (json.minecraftArguments || '').split(' ').filter(Boolean);
  }
  jvm = jvm.map((a) => substitute(a, vars));
  game = game.map((a) => substitute(a, vars));
  if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', classpath);
  if (!jvm.some((a) => a.startsWith('-Djava.library.path='))) jvm.unshift(`-Djava.library.path=${nativesDir}`);
  const logCfg = json.logging?.client;
  if (logCfg?.file) jvm.push(substitute(logCfg.argument, { path: path.join(d.assets, 'log_configs', logCfg.file.id) }));
  if (opts.fullscreen) game.push('--fullscreen');

  const userJvm = (opts.jvmArgs || []).filter(Boolean);
  for (const a of userJvm) if (!/^-[DXa-z]/.test(a)) throw new Error(`Invalid JVM argument "${a}" (must start with - )`);
  const args = [`-Xms${ramMin}M`, `-Xmx${ramMax}M`, ...userJvm, ...jvm, json.mainClass, ...game];
  return { javaPath, args, gameDir, warnings, versionId, required };
}

/** Spawn the game. Resolves handle immediately; `exit` resolves with {code, crashed, crashReport}. */
function launch(prep, { onLog = () => {} } = {}) {
  const logDir = path.join(prep.gameDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `shoaib-${stamp}.log`);
  const out = fs.createWriteStream(logFile);
  const started = Date.now();
  log.info(`launching ${prep.versionId}: ${prep.javaPath} ${log.redact(prep.args.join(' '))}`);
  const child = spawn(prep.javaPath, prep.args, { cwd: prep.gameDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const pipe = (s) => (chunk) => { const t = log.redact(chunk.toString()); out.write(t); onLog(t, s); };
  child.stdout.on('data', pipe('stdout'));
  child.stderr.on('data', pipe('stderr'));
  const exit = new Promise((resolve) => {
    child.on('error', (e) => { out.end(); resolve({ code: -1, crashed: true, error: `Could not start Java: ${e.message}`, logFile }); });
    child.on('close', (code, signal) => {
      out.end();
      let crashReport = null;
      for (const dir of [path.join(prep.gameDir, 'crash-reports'), prep.gameDir]) {
        try {
          for (const f of fs.readdirSync(dir)) {
            if (!/^(crash-.*\.txt|hs_err_pid.*\.log)$/.test(f)) continue;
            const full = path.join(dir, f);
            if (fs.statSync(full).mtimeMs >= started - 1000) crashReport = full;
          }
        } catch { /* no dir */ }
      }
      resolve({ code, signal, crashed: code !== 0 || !!crashReport, crashReport, logFile });
    });
  });
  return { child, exit, logFile, kill: () => child.kill() };
}

module.exports = { prepareLaunch, launch, substitute, collect, dedupeLibs };
