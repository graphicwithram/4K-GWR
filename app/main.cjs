const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, clipboard, session } = require('./desktop-bridge.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { safeUrl, searchDestination, providers } = require('./core.cjs');
const { instagramTarget } = require('./instagram.cjs');
const { downloadImage } = require('./image-download.cjs');
const { downloadArgs } = require('./download-plan.cjs');
let window, browser, storePath, library = [], collections = [], folder, active = null, currentUrl = '', browserVisible = false, quitting = false;
const dataDirectory = process.env.GWR_DATA_DIR && path.isAbsolute(process.env.GWR_DATA_DIR) ? process.env.GWR_DATA_DIR : app.isPackaged ? app.getPath('userData') : path.join(__dirname, '.app-data');
fs.mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
function bootLog(message) { fs.appendFileSync(path.join(dataDirectory, 'startup.log'), `${new Date().toISOString()} ${message}\n`); }
process.on('uncaughtException', error => { bootLog(error.stack || String(error)); console.error(error); app.exit(1); });
process.on('unhandledRejection', error => { bootLog(error?.stack || String(error)); console.error(error); });
let browserBounds = { x: 250, y: 230, width: 800, height: 400 };
const localPage = pathToFileURL(path.join(__dirname, 'index.html')).href;
const toolsDirectory = path.join(app.isPackaged ? process.resourcesPath : __dirname, 'tools');
const downloader = path.join(toolsDirectory, 'yt-dlp.exe');
const save = () => { const temp = `${storePath}.tmp`; fs.writeFileSync(temp, JSON.stringify({ folder, library, collections }, null, 2)); fs.renameSync(temp, storePath); };
function notify() { if (window && !window.isDestroyed()) window.webContents.send('library', { library, folder, downloaderReady: fs.existsSync(downloader) }); }
function browserState(extra = {}) { if (window && !window.isDestroyed()) window.webContents.send('browser-state', { url: currentUrl, canBack: browser.webContents.navigationHistory.canGoBack(), canForward: browser.webContents.navigationHistory.canGoForward(), ...extra }); }
function setBounds() {
  if (!window || !browser) return;
  const [width, height] = window.getContentSize();
  const x = Math.max(0, Math.min(width - 1, Math.round(browserBounds.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(browserBounds.y)));
  browser.setBounds({ x, y, width: Math.max(1, Math.min(width - x, Math.round(browserBounds.width))), height: Math.max(1, Math.min(height - y, Math.round(browserBounds.height))) });
}
function trusted(event) { if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== localPage) throw new Error('This operation is available only to the local app interface.'); }
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { trusted(event); return fn(...args); }); }
function pump() {
  if (active || quitting) return;
  const item = library.filter(i => i.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!item) return;
  if (item.kind === 'image') {
    const abort = new AbortController(); item.status = 'downloading'; item.error = ''; item.progress = 0;
    active = { item, child: { kill: () => abort.abort() } }; save(); notify();
    downloadImage(item, folder, abort.signal, progress => { item.progress = progress; notify(); }).then(result => {
      if (item.status !== 'cancelled' && !quitting) { Object.assign(item, result); item.status = 'completed'; item.progress = 100; }
    }).catch(error => { if (item.status !== 'cancelled' && !quitting) { item.status = 'error'; item.error = error.message; } }).finally(() => { active = null; save(); notify(); pump(); });
    return;
  }
  if (!fs.existsSync(downloader)) { item.status = 'error'; item.error = 'The download engine is missing. Put yt-dlp.exe in the tools folder.'; save(); notify(); return pump(); }
  item.status = 'downloading'; item.error = ''; item.progress = 0;
  const args = downloadArgs(item, folder, toolsDirectory);
  let child;
  try { child = spawn(downloader, args, { windowsHide: true, shell: false }); }
  catch (error) { item.status = 'error'; item.error = error.message; save(); notify(); return pump(); }
  active = { item, child }; save(); notify();
  const buffers = { stdout: '', stderr: '' }; let errors = '';
  function processLines(chunk, stream) {
    buffers[stream] = (buffers[stream] + chunk).slice(-65536);
    const lines = buffers[stream].split(/\r?\n/); buffers[stream] = lines.pop();
    for (const line of lines) {
      if (line.startsWith('FC_PROGRESS:')) { const [percent, speed, eta] = line.slice(12).split('|'); item.progress = Math.max(0, Math.min(100, parseFloat(percent) || 0)); item.speed = speed.trim(); item.eta = eta.trim(); }
      else if (line.startsWith('FC_META:')) { try { item.title = JSON.parse(line.slice(8)); } catch {} }
      else if (line.startsWith('FC_FILE:')) { try { const resolved = path.resolve(JSON.parse(line.slice(8))); const relative = path.relative(folder, resolved); if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) item.file = resolved; } catch {} }
      notify();
    }
  }
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => processLines(chunk, 'stdout'));
  child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); processLines(chunk, 'stderr'); });
  child.on('error', error => { errors = error.message; });
  child.on('close', code => {
    if (item.status !== 'cancelled' && !quitting) {
      item.status = code === 0 && item.file && fs.existsSync(item.file) ? 'completed' : 'error';
      item.progress = item.status === 'completed' ? 100 : item.progress;
      if (item.status === 'error') item.error = errors.trim().slice(-1200) || 'The service did not provide a downloadable file.';
    }
    active = null; save(); notify(); pump();
  });
}
app.whenReady().then(() => {
  bootLog('ready');
  storePath = path.join(app.getPath('userData'), 'library.json');
  folder = process.env.GWR_DATA_DIR ? path.join(dataDirectory, 'Downloads') : app.isPackaged ? path.join(app.getPath('downloads'), '4K GWR') : path.join(__dirname, 'Downloads');
  try { const stored = JSON.parse(fs.readFileSync(storePath, 'utf8')); if (Array.isArray(stored.library)) library = stored.library; if (Array.isArray(stored.collections)) collections = stored.collections; if (typeof stored.folder === 'string' && path.isAbsolute(stored.folder)) folder = stored.folder; } catch {}
  fs.mkdirSync(folder, { recursive: true });
  for (const item of library) if (['downloading', 'queued'].includes(item.status)) { item.status = 'interrupted'; item.error = 'Interrupted when the app closed. Retry to continue the partial download.'; }
  save();
  window = new BrowserWindow({ width: 1260, height: 850, minWidth: 960, minHeight: 660, title: '4K GWR', backgroundColor: '#f7f8fa', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  bootLog('window created');
  window.on('closed', () => bootLog('window closed'));
  const remoteSession = session.fromPartition('persist:gwr-browser');
  remoteSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  remoteSession.setPermissionCheckHandler(() => false);
  remoteSession.on('will-download', event => event.preventDefault());
  browser = new WebContentsView({ webPreferences: { session: remoteSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  bootLog('browser view created');
  window.contentView.addChildView(browser); browser.setVisible(false);
  const guard = (event, url) => { try { safeUrl(url); } catch { event.preventDefault(); } };
  browser.webContents.on('will-navigate', guard); browser.webContents.on('will-redirect', guard);
  browser.webContents.setWindowOpenHandler(({ url }) => { try { const destination = safeUrl(url); browser.webContents.loadURL(destination).catch(() => {}); } catch {} return { action: 'deny' }; });
  browser.webContents.on('did-navigate', (_event, url) => { currentUrl = url; browserState(); });
  browser.webContents.on('did-navigate-in-page', (_event, url) => { currentUrl = url; browserState(); });
  browser.webContents.on('did-start-loading', () => browserState({ loading: true }));
  browser.webContents.on('did-stop-loading', () => browserState({ loading: false }));
  browser.webContents.on('did-fail-load', (_e, code, description, _url, main) => { if (main && code !== -3) browserState({ loading: false, error: description }); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('resize', setBounds);
  handle('get-state', () => ({ library, collections, folder, providers: Object.entries(providers).map(([id, value]) => ({ id, name: value.name, home: value.home })), downloaderReady: fs.existsSync(downloader) }));
  handle('instagram-target', (query, mode) => instagramTarget(query, mode));
  handle('save-collection', (query, mode) => { const target = instagramTarget(query, mode); if (collections.some(c => c.url === target.url)) return collections; if (collections.length >= 500) throw new Error('Your saved-search list is full.'); collections.unshift({ ...target, id: crypto.randomUUID(), createdAt: Date.now() }); save(); return collections; });
  handle('remove-collection', id => { collections = collections.filter(c => c.id !== id); save(); return collections; });
  handle('search', async (input, provider) => { const url = searchDestination(input, provider); currentUrl = url; browserVisible = true; setBounds(); browser.setVisible(true); browser.webContents.loadURL(url).catch(error => browserState({ error: error.message, loading: false })); return url; });
  handle('browser-action', action => { if (action === 'back' && browser.webContents.navigationHistory.canGoBack()) browser.webContents.navigationHistory.goBack(); else if (action === 'forward' && browser.webContents.navigationHistory.canGoForward()) browser.webContents.navigationHistory.goForward(); else if (action === 'reload') browser.webContents.reload(); else if (action === 'hide') { browserVisible = false; browser.setVisible(false); } else if (action === 'show') { browserVisible = true; setBounds(); browser.setVisible(!!currentUrl); } return currentUrl; });
  handle('browser-bounds', bounds => { if (!bounds || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(bounds[k]))) return; browserBounds = bounds; setBounds(); });
  handle('add-download', (request) => {
    if (!request || !['video', 'audio', 'image'].includes(request.kind)) throw new Error('Choose video, audio, or photo.');
    const url = safeUrl(request.url);
    const quality = [720, 1080, 2160].includes(Number(request.quality)) ? Number(request.quality) : 1080;
    if (library.filter(i => ['queued', 'downloading'].includes(i.status)).length >= 100) throw new Error('The queue is full. Wait for downloads to finish.');
    const item = { id: crypto.randomUUID(), title: new URL(url).pathname.split('/').pop() || 'Retrieving video details…', source: new URL(url).hostname.replace(/^www\./, ''), url, quality, kind: request.kind, status: 'queued', progress: 0, createdAt: Date.now() };
    library.unshift(item); save(); notify(); pump(); return item.id;
  });
  handle('cancel', id => { const item = library.find(i => i.id === id); if (item && ['queued', 'downloading'].includes(item.status)) { item.status = 'cancelled'; if (active?.item.id === id) active.child.kill(); save(); notify(); } });
  handle('retry', id => { const item = library.find(i => i.id === id); if (item && ['error', 'cancelled', 'interrupted'].includes(item.status)) { item.status = 'queued'; item.error = ''; save(); notify(); pump(); } });
  handle('open-item', async id => { const item = library.find(i => i.id === id); if (item?.status === 'completed' && item.file && fs.existsSync(item.file)) return shell.openPath(item.file); });
  handle('show-item', id => { const item = library.find(i => i.id === id); if (item?.file && fs.existsSync(item.file)) shell.showItemInFolder(item.file); });
  handle('open-folder', () => shell.openPath(folder));
  handle('choose-folder', async () => { if (active || library.some(i => i.status === 'queued')) throw new Error('Wait for active downloads before changing the folder.'); const choice = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], defaultPath: folder }); if (!choice.canceled && choice.filePaths[0]) { folder = choice.filePaths[0]; save(); notify(); } return folder; });
  handle('read-clipboard', () => clipboard.readText());
  bootLog('loading interface');
  window.loadFile('index.html').then(() => { bootLog('interface loaded'); window.show(); }).catch(error => { bootLog(error.stack); console.error(error); });
}).catch(error => { bootLog(error.stack || String(error)); console.error(error); app.quit(); });
app.on('before-quit', () => { quitting = true; if (active) { active.item.status = 'interrupted'; active.child.kill(); save(); } });
app.on('window-all-closed', () => app.quit());

