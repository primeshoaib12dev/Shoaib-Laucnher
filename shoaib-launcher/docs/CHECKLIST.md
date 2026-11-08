# Feature parity checklist (Battly audit → Shoaib)
Status: Not started | In progress | Implemented | Tested (mock) | Blocked
"Tested (mock)" = automated tests vs local mock server; real-network/real-game test still needed on your PC.

| Feature (Battly reference) | Shoaib implementation | Status |
|---|---|---|
| Version list, all types, search/filter | src/core/versions.js | Tested (mock) |
| Version install (libs/assets/natives/logging) | src/core/install.js | Tested (mock) |
| Download manager core (queue, resume, retry, pause, cancel, speed) | src/core/download.js | Tested (mock) |
| Integrity verify, disk-space check | download.js / install.js | Tested (mock) |
| Java detect + compatibility | src/core/java.js | Tested (real local Java) |
| Java auto-install (Adoptium, SHA256) | java.js installRuntime | Implemented (needs internet test) |
| Offline/local accounts, multi-profile | src/core/accounts.js | Tested |
| Launch engine (args, RAM, JVM, crash detect, log redaction) | src/core/launch.js | Tested (fake java) |
| Real Minecraft launch | launch.js | Implemented (needs real test) |
| Microsoft login (OAuth→Xbox→XSTS→MC) + secure storage | M2 | Not started (needs Azure Client ID) |
| Fabric / Quilt install | src/core/loaders.js | Tested (mock); real API untested |
| NeoForge / Forge / OptiFine install | next | Not started |
| Instances (separate dirs, RAM, Java per instance; create/rename/duplicate/delete/open folder) | src/service.js + GUI | Tested (service + fake DOM) |
| Mod browser/manager (Modrinth; Battly mods panel) | M4 | Not started |
| Modpacks / .mrpack import-export | M4 | Not started |
| Resource packs / shaders | M4 | Not started |
| GUI: Home, Instances, Versions, Accounts, Java, Settings, About | src/renderer | Implemented (page render tested in fake DOM; real Electron untested) |
| News, update screens, themes/backgrounds, languages | next | Not started |
| Windows .exe/installer, Linux AppImage/.deb | package.json build config + scripts | Implemented (not built here) |
| Battly-only: chat, friends, music player, servers list, Discord RPC, Drive sync, analytics, "MyBattly" | Out of scope: depend on Battly's private backend / analytics. Server list & Discord RPC may be added later using public protocols. | Blocked / excluded |

## Added after first build
| Feature | Status |
|---|---|
| Landscape UI (home, profiles, library hub, settings categories) | Implemented (fake-DOM tested; real Electron untested) |
| Version download then Play flow | Tested (mock server) |
| Modrinth + CurseForge search/install, deps, hash verify, restricted-file reporting | Tested (mock API); live API untested |
| Network check (Modrinth/CurseForge/Mojang/Adoptium), timeouts, clear error codes | Tested (mock + closed port + hanging server) |
| Worlds manager, keybindings, touch layout editor | Tested |
| Shoaib+ (auto backups, smart settings, queue, backup to folder, launcher backup) | Tested |
| Touch input injection into the running game | Not started |
| Microsoft login, Forge/NeoForge, cloud sync | Not started / needs server |

## Web mode / Android
| Feature | Status |
|---|---|
| Browser mode (`npm run web`): HTTP bridge, token auth, SSE events, uploads, exports | Tested (real server + real UI code in fake DOM + real process smoke run) |
| Termux/Android: files download and manage | Implemented, tested by simulation only (not on a real phone) |
| Playing on Android/Termux | Blocked by design (desktop natives cannot load); shown clearly in UI |
| APK file | Not built (no Android SDK in the build environment); see docs/ANDROID.md |
