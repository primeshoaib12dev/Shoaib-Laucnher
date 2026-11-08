# UI <-> backend bridge contract (generated from src/api.js)

The whole UI (src/renderer) talks to the backend only through `window.shoaib`. Shells: Electron (src/preload.js), browser/WebView (src/renderer/web-bridge.js + src/server.js).
Any other shell (for example an Android app) can reuse the UI unchanged by providing the same object.

## window.shoaib
- `call(method, ...args) -> Promise` runs a backend method (below); rejects with Error(message). Results are plain JSON.
- `onEvent((name, payload) => ...)` receives backend events (below).
- `openInstanceFolder(id, sub?)`, `openLauncherFolder()`, `pickFile({title,filters})`, `pickSave({defaultPath,filters})`, `afterSave(path)`, `pickFolder()`, `pickJava()`, `openExternal(httpsUrl)`, `relaunch()`
- Desktop only (optional): `winControl('min'|'max'|'close')`, `onWinState(cb)`. Without `winControl` the UI hides its title bar.

## HTTP form (src/server.js)
POST /api/call {method,args} -> {ok,data|error} · GET /api/events (SSE {name,payload}) · POST /api/upload?name= (raw body -> {path}) · GET /api/download?path= (exports folder only).
Every /api request needs the access token (header x-shoaib-token or ?t=). Only methods listed below are callable.

## Backend methods (64)
- `getSettings`
- `setSettings`
- `resetSettings`
- `listVersions`
- `loaderVersions`
- `detectJava`
- `listAccounts`
- `addOfflineAccount`
- `renameAccount`
- `removeAccount`
- `selectAccount`
- `listInstances`
- `createInstance`
- `contentDiagnose`
- `contentSearch`
- `contentVersions`
- `contentInstall`
- `contentInstalled`
- `contentToggle`
- `contentRemove`
- `contentImportLocal`
- `contentCheckUpdates`
- `contentUpdateItem`
- `contentInstallModpack`
- `contentImportModpack`
- `contentExportMrpack`
- `worldsList`
- `worldsBackup`
- `worldsDelete`
- `worldsImportZip`
- `controlsGet`
- `controlsSet`
- `controlsReset`
- `touchList`
- `touchSave`
- `touchDelete`
- `touchSetActive`
- `plusRecommend`
- `plusApplyRecommended`
- `plusBackupWorlds`
- `plusBackupProfile`
- `plusRestoreProfile`
- `plusExportBackup`
- `plusImportBackup`
- `plusQueueInstalls`
- `plusQueueCancel`
- `plusState`
- `getStorage`
- `setStorage`
- `resetStorage`
- `selectInstance`
- `renameInstance`
- `updateInstance`
- `duplicateInstance`
- `deleteInstance`
- `installInstance`
- `pauseInstall`
- `resumeInstall`
- `cancelInstall`
- `play`
- `stop`
- `instanceFolder`
- `exportPath`
- `getPlatform`

## Events (10)
- `install-progress`
- `install-stage`
- `install-state`
- `install-done`
- `game-log`
- `game-state`
- `game-exit`
- `content-progress`
- `plus-queue`
- `plus-backup`
