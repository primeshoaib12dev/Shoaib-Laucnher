# Making an APK (what is possible, honestly)

This project is an **Electron** desktop app (Node.js backend + HTML/CSS/JS UI). A "website to APK" tool or a plain WebView wrapper can show the
UI, but there is **no Node.js on Android**, so downloads, install and launch would not work. An APK needs these parts:

| Part | Can the UI be reused? | What must be written |
|---|---|---|
| Screens (HTML/CSS/JS) | Yes, unchanged (`src/renderer`) | Load in a WebView, provide `window.shoaib` (see BRIDGE.md) |
| Version list, download, SHA1 verify, resume, Modrinth/CurseForge, worlds, backups | Logic is documented and tested here | Re-implement in Kotlin (same behaviour, same method names) |
| Java runtime for Android | No | Android-built JRE (Adoptium does not provide one) |
| OpenGL on Android | No | OpenGL translation layer (gl4es / Zink) |
| Minecraft natives (LWJGL) | No | Android-patched LWJGL natives |
| Touch controls reaching the game | Layout editor exists | Input bridge inside the runtime |

The last four rows are what PojavLauncher (open source) already solves. The practical way to a working APK is to start from its runtime and attach the Shoaib
UI and Kotlin versions of the backend methods. That needs Android Studio + NDK and has to be built and tested on a real phone; it cannot be verified from a server.

Until then, the supported way to run on a phone is Ubuntu on the phone (proot/Termux X11) with `npm run start:proot`.

## Web mode is the stepping stone
`npm run web` already runs the real backend behind an HTTP bridge (`src/server.js`). An APK can reuse it: ship the Node.js runtime for Android
(the open-source `nodejs-mobile` project) inside the APK, start `src/web.js`-style server on 127.0.0.1 from a small Android Activity, and show the UI in a WebView.
Downloads, Modrinth/CurseForge, worlds and backups then work unchanged. Playing still needs the Pojav-style runtime (Java for Android, OpenGL layer, patched LWJGL).
Building the APK requires Android Studio (or a CI service) and has to be tested on a real phone.
