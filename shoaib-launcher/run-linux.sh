#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 20+ first"; exit 1; }
[ -d node_modules ] || npm install
npm start
