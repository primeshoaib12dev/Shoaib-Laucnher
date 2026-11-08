'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron');
const path = require('path');
const { Service } = require('./service');
const { METHODS, EVENTS } = require('./api');

let win = null;
let svc = null;



if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 720, minWidth: 800, minHeight: 450, frame: false, backgroundColor: '#07080d', title: 'Shoaib Launcher V1',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('maximize', () => win.webContents.send('win-state', true));
  win.on('unmaximize', () => win.webContents.send('win-state', false));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  svc = new Service();
  for (const ev of EVENTS) svc.on(ev, (p) => win && !win.isDestroyed() && win.webContents.send('evt', ev, p));
  svc.on('game-state', (p) => { if (!win || !svc.settings.hideOnLaunch) return; if (p.running) win.minimize(); else win.restore(); });

  ipcMain.handle('svc', async (_e, method, ...args) => {
    if (!METHODS.has(method)) return { ok: false, error: `Unknown method ${method}` };
    try { return { ok: true, data: await svc[method](...args) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('open-instance-folder', async (_e, id, sub) => { try { const ok = ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'backups'].includes(sub); const dir = ok ? require('path').join(svc.instanceDir(id), sub) : svc.instanceDir(id); if (ok) require('fs').mkdirSync(dir, { recursive: true }); const err = await shell.openPath(dir); return err ? { ok: false, error: err } : { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
  ipcMain.handle('open-launcher-folder', async () => { await shell.openPath(svc.d.root); return { ok: true }; });
  ipcMain.handle('pick-java', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Select Java executable', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'java.exe', extensions: ['exe'] }] : [] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('win-control', (_e, a) => { if (!win) return; if (a === 'min') win.minimize(); else if (a === 'max') { win.isMaximized() ? win.unmaximize() : win.maximize(); } else if (a === 'close') win.close(); });
  ipcMain.handle('pick-file', async (_e, o = {}) => { const r = await dialog.showOpenDialog(win, { title: o.title || 'Select file', properties: ['openFile'], filters: o.filters || [] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('pick-save', async (_e, o = {}) => { const r = await dialog.showSaveDialog(win, { defaultPath: o.defaultPath, filters: o.filters || [] }); return r.canceled ? null : r.filePath; });
  ipcMain.handle('pick-folder', async () => { const r = await dialog.showOpenDialog(win, { title: 'Choose storage folder', properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('relaunch', () => { app.relaunch(); app.exit(0); });
  ipcMain.handle('open-external', (_e, url) => { try { const u = new URL(url); if (u.protocol === 'https:') { shell.openExternal(u.href); return true; } } catch { /* ignore */ } return false; });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
