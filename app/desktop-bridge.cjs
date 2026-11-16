const readline = require('node:readline');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const handlers = new Map();
const pending = new Map();
let seq = 0, mainWindow, browser, clipboardText = '';
let history = { canBack: false, canForward: false };
let ready;
const started = new Promise(resolve => { ready = resolve; });
const send = (type, value) => process.stdout.write(JSON.stringify({ type, value }) + '\n');
const request = (type, value) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  send('host-request', { id, type, value });
});
const app = new EventEmitter();
Object.assign(app, {
  isPackaged: true,
  getPath: key => key === 'downloads' ? path.join(os.homedir(), 'Downloads') :
    app.data || path.join(process.env.APPDATA, '4K GWR'),
  setPath: (_key, value) => { app.data = value; },
  whenReady: () => started,
  exit: code => process.exit(code),
  quit: () => send('quit')
});
process.resourcesPath = path.resolve(__dirname, '..');
class BrowserWindow extends EventEmitter {
  constructor() {
    super();
    mainWindow = this;
    this.contentView = { addChildView() {} };
    this.webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: pathToFileURL(path.join(__dirname, 'index.html')).href },
      setWindowOpenHandler() {},
      send: (name, value) => send('event', { name, value })
    });
  }
  isDestroyed() { return false; }
  getContentSize() { return [100000, 100000]; }
  loadFile() { return request('load-interface'); }
  show() {}
}
class WebContentsView {
  constructor() {
    browser = this;
    this.webContents = Object.assign(new EventEmitter(), {
      navigationHistory: {
        canGoBack: () => history.canBack,
        canGoForward: () => history.canForward,
        goBack: () => send('back'),
        goForward: () => send('forward')
      },
      setWindowOpenHandler() {},
      reload: () => send('reload'),
      loadURL: url => request('navigate', url)
    });
  }
  setVisible(visible) { send('visibility', visible); }
  setBounds(bounds) { send('bounds', bounds); }
}
const session = { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} }) };
const shell = { openPath: file => request('open', file), showItemInFolder: file => request('show', file).catch(console.error) };
const dialog = { showOpenDialog: (_window, options) => request('folder', options.defaultPath) };
const clipboard = { readText: () => clipboardText };
const ipcMain = { handle: (name, callback) => handlers.set(name, callback) };

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let message;
  try {
    message = JSON.parse(line);
    switch (message.type) {
      case 'start': ready(); break;
      case 'host-response': {
        const waiter = pending.get(message.id);
        if (!waiter) break;
        pending.delete(message.id);
        message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.value);
        break;
      }
      case 'invoke': {
        const wc = mainWindow.webContents;
        const callback = handlers.get(message.name);
        if (!callback) throw new Error('Unknown app command.');
        clipboardText = message.clipboard || '';
        const value = await callback({ sender: wc, senderFrame: wc.mainFrame }, ...message.args);
        send('response', { id: message.id, value: value ?? null });
        break;
      }
      case 'browser':
        history = message;
        if (message.phase === 'start') browser.webContents.emit('did-start-loading');
        if (message.url && message.phase !== 'start') browser.webContents.emit('did-navigate', null, message.url);
        if (message.phase === 'end') browser.webContents.emit('did-stop-loading');
        if (message.error) browser.webContents.emit('did-fail-load', null, 0, message.error, message.url, true);
        break;
      case 'quit':
        app.emit('before-quit');
        process.exit();
    }
  } catch (error) {
    if (message?.type === 'invoke') send('response', { id: message.id, error: error.message });
    else console.error(error);
  }
}).on('close', () => app.emit('before-quit'));
module.exports = { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog, clipboard, session };
