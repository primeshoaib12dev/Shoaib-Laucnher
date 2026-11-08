#!/usr/bin/env bash
cd "$(dirname "$0")"
npm install && npm run dist:linux && echo "AppImage + .deb in dist/"
