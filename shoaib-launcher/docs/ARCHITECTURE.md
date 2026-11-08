# Architecture decisions
- **Electron + Node (CommonJS)**: same stack class as the reference, lets the UI be web tech; core has **zero npm dependencies** (own ZIP reader, fetch, streams) so it runs/tests anywhere with Node 20+.
- **Core is UI-free** (`src/core`): events (`progress`, `stage`, `state`) drive any UI/CLI. Electron `main.js` + renderer come in M5.
- **Version is "installed" only via a marker written after full verification**; Play enabled only then.
- **Java**: exact 8 for Java-8 versions; >= required otherwise; auto-install only from Adoptium API with SHA256.
- **Secrets**: `logger.addSecret` + redaction on every log/game-output line. Microsoft tokens will use OS keychain (M2).
- **Shared** libraries/assets/versions, **per-instance** game directories (no mixing).
