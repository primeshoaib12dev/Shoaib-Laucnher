# Shoaib Launcher V1 — Mod By Shoaib
Minecraft Java launcher with a landscape (16:9), touch-friendly UI. Windows + Ubuntu/Linux (also Ubuntu running on a phone).

## Chalane ka tareeka
1. Node.js 20+ install karo (https://nodejs.org).
2. **Windows:** `run-windows.bat` double-click. **Linux:** `./run-linux.sh`. (Pehli baar `npm install` khud hoga, Electron download hota hai, internet chahiye.)
3. **Ubuntu on phone (proot/Termux):** `npm install` ke baad `npm run start:proot`.
4. Top right chip se local account add karo → **Versions** → Create new profile → **Download** → **Play**.

## Phone par (Android) — bina APK ke, abhi
Termux mein launcher browser mode mein chalta hai: versions download, mods/modpacks/shaders/resource packs, worlds, backups, Shoaib+ sab. **Game chalana (Play) Android par possible nahi** (Minecraft ki desktop libraries Android load nahi kar sakta); Play button "Downloaded" dikhata hai. Play ke liye PC ya Pojav jaisa Android launcher chahiye.
```
pkg update -y && pkg install -y nodejs unzip
termux-setup-storage                 # storage permission (ek baar)
cd ~ && unzip ~/storage/downloads/shoaib-launcher-*.zip
cd shoaib-launcher && npm run web    # npm install ki zaroorat nahi
```
Terminal jo link dikhata hai (`http://127.0.0.1:8787/?t=...`) use Chrome mein kholo (landscape). `termux-wake-lock` chalao taaki screen band hone par bhi downloads chalte rahein. Data phone storage mein rakhna ho: Settings → Storage → `/storage/emulated/0/ShoaibLauncher` (Java runtime internal hi rehta hai). Exports (`.mrpack`, backup file) browser se download hote hain.
Link private rakho: usme access token hai. Server sirf is phone (127.0.0.1) par sunta hai.

## Mods / modpacks / shaders / resource packs
Library → Browse. Modrinth bina key ke chalta hai. CurseForge ke liye Settings → CurseForge mein apni free API key (console.curseforge.com).
**Agar kuch load nahi ho raha:** Settings → **Network check**. Wo bata dega ki Modrinth / CurseForge / Mojang / Java mein kaun si service nahi mil rahi aur kyun (DNS, TLS, timeout, galat key). Phone par Ubuntu mein DNS ke liye: `echo "nameserver 8.8.8.8" > /etc/resolv.conf`.

## .exe / installer / AppImage / .deb
Windows par `build-windows.bat`, Ubuntu par `./build-linux.sh` (output `dist/`).

## Kya hai
Home (news card, Versions, Play/Download) • profiles (Vanilla/Fabric/Quilt, Mojang version list) • Library hub (Modrinth + CurseForge mods, modpacks, resource packs, shaders; `.mrpack` import/export; enable/disable/update) • Worlds (backup/import/delete) • Controls (keybindings in options.txt + touch layout editor) • Settings (video, RAM/JVM, Java, storage location, CurseForge key, network check) • **Shoaib+** (auto world backups, smart settings, download queue, backup to folder, launcher backup file; free and local).

## Honest limits
- Tests (`npm test`) use a local mock server, fake Java and a fake DOM. **Electron window, live Modrinth/CurseForge/Mojang/Adoptium requests and a real game launch were NOT tested in the build sandbox (no internet).** Pehli real run tumhare device par hogi.
- Touch layouts are saved and editable, but sending touches into a running game is not built yet.
- Not built: Microsoft login, Forge/NeoForge, cloud sync (needs a server), news feed beyond Mojang's latest versions, auto-update.
- Phone par game software rendering se slow ho sakta hai.

## Legal
Battly ka code/asset/text/API use nahi hua (uska EULA copy mana karta hai); sirf feature list reference thi. `docs/LEGAL.md` dekho.
