'use strict';
const fs = require('fs');
const path = require('path');

const secrets = new Set();
/** Register a secret (access token etc.) so it is never written to logs. */
function addSecret(s) { if (s && String(s).length > 6) secrets.add(String(s)); }
function redact(text) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('***REDACTED***');
  out = out.replace(/(--accessToken\s+)\S+/g, '$1***REDACTED***');
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1***REDACTED***');
  return out;
}

let logFile = null;
function setLogDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'launcher.log');
}
function write(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${redact(msg)}`;
  if (logFile) { try { fs.appendFileSync(logFile, line + '\n'); } catch { /* ignore */ } }
  if (process.env.SHOAIB_DEBUG) console.error(line);
}
module.exports = {
  addSecret, redact, setLogDir,
  info: (m) => write('INFO', m),
  warn: (m) => write('WARN', m),
  error: (m) => write('ERROR', m),
};
