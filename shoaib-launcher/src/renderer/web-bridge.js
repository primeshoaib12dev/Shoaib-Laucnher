'use strict';
// Browser/WebView implementation of window.shoaib (used when the page is served by src/server.js; Electron's preload defines it otherwise).
(function () {
  if (window.shoaib) return;
  const q = new URLSearchParams(location.search); let token = q.get('t') || '';
  try { if (token) { sessionStorage.setItem('shoaib-token', token); history.replaceState(null, '', location.pathname); } else token = sessionStorage.getItem('shoaib-token') || ''; } catch { /* storage blocked: keep in memory */ }
  const headers = () => ({ 'content-type': 'application/json', 'x-shoaib-token': token });
  async function call(method, ...args) {
    let r; try { r = await fetch('/api/call', { method: 'POST', headers: headers(), body: JSON.stringify({ method, args }) }); } catch { throw new Error('Cannot reach the launcher. Is it still running in Termux/terminal?'); }
    let j; try { j = await r.json(); } catch { throw new Error('Unexpected answer from the launcher'); }
    if (!j.ok) throw new Error(j.error || 'Request failed'); return j.data;
  }
  function chooser(accept) {
    return new Promise((resolve) => {
      const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept;
      i.addEventListener('change', async () => {
        const f = i.files && i.files[0]; if (!f) return resolve(null);
        try { const r = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'x-shoaib-token': token }, body: f }); const j = await r.json(); if (!j.ok) throw new Error(j.error); resolve(j.path); }
        catch (e) { alert('Upload failed: ' + e.message); resolve(null); }
      });
      i.addEventListener('cancel', () => resolve(null)); i.click();
    });
  }
  const accept = (o) => ((o && o.filters) || []).flatMap((f) => f.extensions || []).filter((x) => x !== '*').map((x) => '.' + x).join(',');
  window.shoaib = {
    call,
    onEvent(cb) { const es = new EventSource('/api/events?t=' + encodeURIComponent(token)); es.onmessage = (e) => { try { const m = JSON.parse(e.data); cb(m.name, m.payload); } catch { /* ignore */ } }; return es; },
    pickFile: (o) => chooser(accept(o)),
    pickSave: async (o) => call('exportPath', (o && o.defaultPath) || 'export'),
    afterSave: async (p) => { const a = document.createElement('a'); a.href = '/api/download?t=' + encodeURIComponent(token) + '&path=' + encodeURIComponent(p); a.download = ''; document.body.appendChild(a); a.click(); a.remove(); },
    pickFolder: async () => { const v = prompt('Folder path on this device (for example /storage/emulated/0/ShoaibLauncher):'); return v && v.trim() ? v.trim() : null; },
    pickJava: async () => { const v = prompt('Full path of the java executable:'); return v && v.trim() ? v.trim() : null; },
    openExternal: async (u) => { window.open(u, '_blank', 'noopener'); return true; },
    openInstanceFolder: async (id, sub) => { alert('Folder on this device:\n' + (await call('instanceFolder', id, sub))); },
    openLauncherFolder: async () => { alert('Launcher data folder:\n' + (await call('getStorage')).root); },
    relaunch: async () => { alert('Stop the launcher (Ctrl+C in Termux) and start it again to apply the change.'); },
  };
})();
