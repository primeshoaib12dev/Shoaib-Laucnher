#!/usr/bin/env node
'use strict';
// Developer CLI for the Shoaib Launcher core engine (M1).
const readline = require('readline');
const { dirs, ensure } = require('./core/paths');
const log = require('./core/logger');
const V = require('./core/versions');
const { installVersion } = require('./core/install');
const { DownloadQueue } = require('./core/download');
const { prepareLaunch, launch } = require('./core/launch');
const { AccountStore } = require('./core/accounts');
const java = require('./core/java');

const d = dirs();
ensure(d.root, d.mc);
log.setLogDir(d.logs);
const [cmd, ...args] = process.argv.slice(2);

const fmt = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB');
async function main() {
  const accounts = new AccountStore(d);
  switch (cmd) {
    case 'list': {
      const type = args.find((a) => a.startsWith('--type='))?.split('=')[1];
      const search = args.find((a) => !a.startsWith('--'));
      const { versions, offline, latest } = await V.listVersions(d, { type, search });
      if (offline) console.log('(offline - showing cached list)');
      if (latest) console.log(`latest release: ${latest.release}  latest snapshot: ${latest.snapshot}`);
      for (const v of versions.slice(0, 60)) console.log(`${v.installed ? '[x]' : '[ ]'} ${v.id.padEnd(24)} ${v.type.padEnd(10)} ${(v.releaseTime || '').slice(0, 10)}`);
      console.log(`${versions.length} versions`);
      break;
    }
    case 'install': {
      const id = args[0]; if (!id) throw new Error('usage: install <version>');
      const q = new DownloadQueue();
      q.on('stage', (s) => console.log(`\n== ${s}`));
      q.on('progress', (p) => process.stdout.write(`\r${p.stage}: ${p.percent.toFixed(1)}%  ${p.doneFiles}/${p.totalFiles} files  ${fmt(p.doneBytes)}/${fmt(p.totalBytes)}  ${fmt(p.speed)}/s   `));
      process.on('SIGINT', () => { console.log('\ncancelling...'); q.cancel(); });
      const r = await installVersion(d, id, { queue: q });
      console.log(`\nInstalled ${r.id}. Java: ${r.javaPath}`);
      break;
    }
    case 'java': {
      const all = await java.detectJava(d);
      for (const j of all) console.log(`Java ${j.major}  ${j.version}  ${j.path}`);
      if (!all.length) console.log('No Java found');
      break;
    }
    case 'account': {
      const [sub, name] = args;
      if (sub === 'add') console.log('added', accounts.addOffline(name));
      else if (sub === 'remove') accounts.remove('offline:' + name.toLowerCase());
      else if (sub === 'select') accounts.select('offline:' + name.toLowerCase());
      else for (const a of accounts.list()) console.log(`${a.id === accounts.data.selected ? '*' : ' '} [OFFLINE] ${a.name} ${a.uuid}`);
      break;
    }
    case 'launch': {
      const id = args[0]; if (!id) throw new Error('usage: launch <version> [--ram=2048] [--dir=path]');
      const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
      const prep = await prepareLaunch({ d, versionId: id, account: accounts.selected(), ramMax: opt('ram') ? +opt('ram') : undefined, gameDir: opt('dir') });
      prep.warnings.forEach((w) => console.warn('WARNING:', w));
      const h = launch(prep, { onLog: (t) => process.stdout.write(t) });
      const r = await h.exit;
      console.log(`\nGame exited with code ${r.code}${r.crashed ? ' (CRASH)' : ''}. Log: ${r.logFile}${r.crashReport ? '\nCrash report: ' + r.crashReport : ''}`);
      break;
    }
    default:
      console.log('Shoaib Launcher core CLI (Mod By Shoaib)\n  list [search] [--type=release|snapshot|old_beta|old_alpha]\n  install <version>\n  java\n  account [add|remove|select <name>]\n  launch <version> [--ram=MB] [--dir=path]');
  }
}
main().catch((e) => { console.error('\nError:', e.message); process.exit(1); });
