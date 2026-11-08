'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');

function osName() {
  return { win32: 'windows', darwin: 'osx', linux: 'linux', android: 'linux' }[process.platform] || process.platform;
}
/** Node inside Termux / an Android app reports platform 'android' (Bionic libc, no desktop natives). */
function isAndroid() { return process.platform === 'android'; }
function archName() {
  return { x64: 'x64', arm64: 'arm64', ia32: 'x86' }[process.arch] || process.arch;
}
function defaultRoot() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ShoaibLauncher');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'ShoaibLauncher');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ShoaibLauncher');
}
function locationFile() { return path.join(defaultRoot(), 'location.json'); }
function readLocation() { try { return JSON.parse(fs.readFileSync(locationFile(), 'utf8')); } catch { return null; } }
/** Where game data lives: SHOAIB_HOME env > user-chosen location (location.json) > default. */
function dataRoot() {
  if (process.env.SHOAIB_HOME) return process.env.SHOAIB_HOME;
  const l = readLocation();
  return l && l.root ? l.root : defaultRoot();
}
function dirs(root = dataRoot(), opts = {}) {
  const mc = path.join(root, 'minecraft');
  return {
    root,
    mc,
    versions: path.join(mc, 'versions'),
    libraries: path.join(mc, 'libraries'),
    assets: path.join(mc, 'assets'),
    runtimes: opts.runtimes || path.join(root, 'runtimes'),
    instances: path.join(root, 'instances'),
    logs: path.join(root, 'logs'),
    cache: path.join(root, 'cache'),
  };
}
function ensure(...p) { for (const d of p) fs.mkdirSync(d, { recursive: true }); }

module.exports = { osName, archName, isAndroid, dataRoot, defaultRoot, locationFile, readLocation, dirs, ensure };
