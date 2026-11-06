const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  dialog,
  ipcMain,
  shell,
  screen,
  nativeImage,
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runOffice } = require('./office');
const { createConverter, FORMATS, textToDocx } = require('./convert');
const { MEDIA, MEDIA_EXT, convertMedia } = require('./media');

const logFile = path.join(__dirname, 'converts.log');

process.on('uncaughtException', (error) => {
  try {
    fs.appendFileSync(logFile, `uncaught ${error.stack || error}\n`);
  } catch {}
});
process.on('unhandledRejection', (error) => {
  const text = error && error.stack ? error.stack : String(error);
  try {
    fs.appendFileSync(logFile, `rejection ${text}\n`);
  } catch {}
});
let win = null;
let card = null;
let tray = null;
let quitting = false;
let current = null;
let samplePath = '';
let lastSaved = '';
const jobs = [];
let working = false;
let watched = { kind: 'none', name: '', path: '', saved: false, ext: '' };
let watchGen = 0;
let watchTimer = null;

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {}
}

function friendly(error) {
  const raw = String((error && error.message) || error || '');
  const line = raw.split('\n')[0].replace(/^Error:\s*/, '').trim();
  if (!line || line.length > 180 || /node_modules|pdfjs|at\s+\w+/.test(raw)) {
    return 'Não consegui converter para esse formato.';
  }
  return line;
}

let rasterWin = null;
let rasterReady = null;
let printWin = null;

function workerOptions() {
  return {
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  };
}

function ensureRaster() {
  if (rasterWin && !rasterWin.isDestroyed()) return rasterReady;
  rasterWin = new BrowserWindow(workerOptions());
  rasterReady = new Promise((resolve, reject) => {
    rasterWin.webContents.once('did-finish-load', () => resolve());
    rasterWin.webContents.once('did-fail-load', () => reject(new Error('O renderizador não abriu.')));
  });
  rasterWin.loadFile(path.join(__dirname, 'ui', 'raster.html'));
  return rasterReady;
}

function renderPdf(pdfPath, outputs) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      finish(new Error('A renderização do PDF demorou demais.'));
    }, 30000);

    function finish(error, value) {
      clearTimeout(timer);
      ipcMain.removeListener('raster-done', onDone);
      if (error) reject(error);
      else resolve(value);
    }

    function onDone(_event, message) {
      if (!message || message.id !== id) return;
      if (!message.ok) finish(new Error(message.error || 'Falha ao renderizar.'));
      else finish(null, message);
    }

    ipcMain.on('raster-done', onDone);
    ensureRaster()
      .then(() => {
        if (!rasterWin || rasterWin.isDestroyed()) throw new Error('O renderizador fechou.');
        rasterWin.webContents.send('raster', { id, src: pdfPath, ...outputs });
      })
      .catch((error) => finish(error));
  });
}

function htmlToPdf(html, dest) {
  if (!printWin || printWin.isDestroyed()) printWin = new BrowserWindow(workerOptions());
  const file = path.join(os.tmpdir(), 'converts-arquivos', 'print.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, 'utf8');
  return printWin.loadFile(file).then(() => printWin.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
  })).then((data) => {
    fs.writeFileSync(dest, data);
    return dest;
  });
}

const converter = createConverter({
  runOffice: (action, vars) => runOffice(action, vars, log, 20000),
  renderPdf,
  htmlToPdf,
  log,
});

function normalizeSource(source) {
  const next = source || { kind: 'none', name: '', path: '', saved: false, ext: '' };
  next.ext = (next.ext || '').toLowerCase();
  next.kind = next.kind || 'none';
  next.name = next.name || '';
  next.path = next.path || '';
  return next;
}

async function ensureSample() {
  const dir = path.join(__dirname, 'exemplos');
  fs.mkdirSync(dir, { recursive: true });
  const docxPath = path.join(dir, 'Exemplo.docx');
  if (!fs.existsSync(docxPath)) {
    await textToDocx(
      [
        'Converts',
        '',
        'Abra este arquivo no Word, aperte Ctrl+Shift+Espaço e escolha o formato no seletor.',
        '',
        'O arquivo convertido vai para a pasta Downloads, dentro de Converts.',
        'Dá para salvar em PDF, Word, PNG, JPEG, SVG, HTML, texto e RTF.',
      ].join('\n'),
      docxPath
    );
  }
  return docxPath;
}

function appIcon() {
  const ico = path.join(__dirname, 'assets', 'icon.ico');
  const png = path.join(__dirname, 'assets', 'icon.png');
  const file = fs.existsSync(ico) ? ico : png;
  let icon = nativeImage.createFromPath(file);
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  return icon.isEmpty() ? nativeImage.createEmpty() : icon;
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    icon: appIcon(),
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

function reveal(source) {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  win.setBounds(display.bounds);
  win.show();
  win.moveTop();
  win.focus();
  win.webContents.send('wheel-open', { source, formats: FORMATS });
}

function hideWheel() {
  if (win && !win.isDestroyed()) win.hide();
}

function createCard() {
  card = new BrowserWindow({
    icon: appIcon(),
    width: 300,
    height: 88,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    hasShadow: true,
    backgroundColor: '#171717',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  card.setAlwaysOnTop(true, 'screen-saver');
  card.setMenuBarVisibility(false);
  card.loadFile(path.join(__dirname, 'ui', 'card.html'));
  card.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      card.hide();
    }
  });
}

function placeCard(phase) {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const margin = 16;
  const width = 300;
  const height = phase === 'done' ? 118 : 86;
  card.setBounds({
    x: display.workArea.x + display.workArea.width - width - margin,
    y: display.workArea.y + margin,
    width,
    height,
  });
}

function showCard(state) {
  if (!card || card.isDestroyed()) return;
  placeCard(state.phase);
  const send = () => card.webContents.send('card-state', state);
  if (card.webContents.isLoading()) card.webContents.once('did-finish-load', send);
  else send();
  card.show();
  card.moveTop();
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg']);

function typeClash(source, lane, formatId) {
  if (!source || source.kind === 'none') return '';
  const ext = (source.ext || '').toLowerCase();
  if (lane === 'audio' && IMAGE_EXT.has(ext)) return 'Não dá para converter imagem em áudio.';
  const imageTarget = formatId === 'png' || formatId === 'jpg' || formatId === 'svg';
  if (lane === 'file' && MEDIA_EXT.has(ext) && imageTarget) return 'Não dá para converter áudio em imagem.';
  return '';
}

function enqueue(source, formatId, lane) {
  const list = lane === 'audio' ? MEDIA : FORMATS;
  const format = list.find((item) => item.id === formatId);
  jobs.push({
    source,
    formatId,
    lane: lane === 'audio' ? 'audio' : 'file',
    label: format ? format.label : formatId,
    ext: format ? format.ext : '',
  });
  pump();
}

function pump() {
  if (working) return;
  const job = jobs.shift();
  if (!job) return;
  working = true;
  showCard({
    phase: 'run',
    title: `Convertendo ${job.label}`,
    file: job.source.name || 'Arquivo',
  });
  const task = job.lane === 'audio'
    ? (() => {
      const output = converter.outputPath(job.source, job.ext);
      return convertMedia(job.source, job.formatId, output.path).then(() => ({
        path: output.path,
        shortPath: output.shortPath,
        label: job.label,
      }));
    })()
    : converter.convert(job.source, job.formatId);
  task.then((result) => {
    lastSaved = result.path;
    log('salvo', result.path);
    showCard({
      phase: 'done',
      title: `${job.label} pronto`,
      file: result.path,
    });
  }).catch((error) => {
    log('convert', error.stack || error.message);
    showCard({
      phase: 'error',
      title: friendly(error),
      file: job.source.name || '',
    });
  }).finally(() => {
    working = false;
    if (jobs.length) pump();
  });
}

function rememberProbe(probe) {
  if (!probe || !probe.source) return;
  watched = normalizeSource(probe.source);
}

function armWatch() {
  clearTimeout(watchTimer);
  const gen = watchGen;
  watchTimer = setTimeout(async () => {
    if (gen !== watchGen || quitting) return;
    if (win && win.isVisible()) {
      armWatch();
      return;
    }
    try {
      rememberProbe(await runOffice('probe', {}, log, 1800));
    } catch (error) {
      log('probe', error.message);
    }
    if (gen === watchGen) armWatch();
  }, 280);
}

function openWheel() {
  if (!win) return;
  if (win.isVisible()) {
    hideWheel();
    watchGen += 1;
    armWatch();
    return;
  }
  watchGen += 1;
  current = { ...watched };
  converter.reset();
  reveal(current);
}

async function pickFile(lane) {
  const audio = lane === 'audio';
  const result = await dialog.showOpenDialog(win && win.isVisible() ? win : undefined, {
    title: audio ? 'Escolher áudio ou vídeo' : 'Escolher arquivo para converter',
    properties: ['openFile'],
    filters: [
      audio
        ? {
          name: 'Áudio e vídeo',
          extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'mp4', 'mkv', 'webm', 'mov', 'avi'],
        }
        : {
          name: 'Documentos e imagens',
          extensions: [
            'doc', 'docx', 'docm', 'pdf', 'txt', 'rtf', 'html', 'htm', 'odt',
            'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg',
            'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx',
          ],
        },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = result.filePaths[0];
  return {
    kind: 'file',
    name: path.basename(file),
    path: file,
    saved: true,
    ext: path.extname(file).toLowerCase(),
  };
}

function loginExe() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function startupFile() {
  return path.join(app.getPath('userData'), 'startup-choice.json');
}

function readStartupChoice() {
  try {
    return JSON.parse(fs.readFileSync(startupFile(), 'utf8'));
  } catch {
    return null;
  }
}

function applyStartup(openAtLogin) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin, path: loginExe() });
  fs.mkdirSync(path.dirname(startupFile()), { recursive: true });
  fs.writeFileSync(startupFile(), JSON.stringify({ openAtLogin }));
}

function ensureStartup() {
  if (!app.isPackaged) return;
  if (!readStartupChoice()) applyStartup(true);
}

function startupChecked() {
  if (!app.isPackaged) return false;
  const choice = readStartupChoice();
  if (choice) return !!choice.openAtLogin;
  return !!app.getLoginItemSettings({ path: loginExe() }).openAtLogin;
}

function createTray() {
  tray = new Tray(appIcon());
  paintTray();
  tray.on('double-click', () => openWheel());
}

const DEFAULT_ACCEL = 'CommandOrControl+Shift+Space';
const ACCEL_MODS = new Set(['CommandOrControl', 'Control', 'Ctrl', 'Alt', 'Shift', 'AltGr']);
const ACCEL_KEYS = new Set([
  'Space', 'Tab', 'Esc', 'Up', 'Down', 'Left', 'Right',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);
let shortcutState = { custom: [], keepDefault: true };

function shortcutsFile() {
  return path.join(app.getPath('userData'), 'shortcuts.json');
}

function loadShortcuts() {
  try {
    const data = JSON.parse(fs.readFileSync(shortcutsFile(), 'utf8'));
    const custom = Array.isArray(data.custom) ? data.custom.filter(validAccel).slice(0, 3) : [];
    return { custom, keepDefault: data.keepDefault !== false };
  } catch {
    return { custom: [], keepDefault: true };
  }
}

function validAccel(accel) {
  const parts = String(accel || '').split('+').filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  const key = parts[parts.length - 1];
  if (!parts.slice(0, -1).every((part) => ACCEL_MODS.has(part))) return false;
  if (ACCEL_MODS.has(key)) return false;
  if (/^[A-Z0-9]$/.test(key) || ACCEL_KEYS.has(key)) return true;
  return /^(Return|Backspace|Delete|Insert|Home|End|PageUp|PageDown|num[0-9]|numadd|numsub|nummult|numdiv|numdec)$/.test(key);
}

function prettyAccel(accel) {
  return String(accel)
    .replace(/CommandOrControl|Control|Ctrl/g, 'Ctrl')
    .replace(/Space/g, 'Espaço')
    .split('+')
    .join('+');
}

function shortcutLabel() {
  const list = [];
  if (shortcutState.keepDefault) list.push(prettyAccel(DEFAULT_ACCEL));
  shortcutState.custom.forEach((accel) => {
    const label = prettyAccel(accel);
    if (!list.includes(label)) list.push(label);
  });
  return list.join(' · ') || 'nenhum';
}

function paintTray() {
  if (!tray) return;
  tray.setToolTip(`Converts — ${shortcutLabel()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir seletor', click: () => openWheel() },
    {
      label: 'Escolher arquivo…',
      click: async () => {
        const picked = await pickFile();
        if (!picked) return;
        current = picked;
        converter.reset();
        reveal(current);
      },
    },
    {
      label: 'Abrir pasta das conversões',
      click: () => shell.openPath(converter.downloadsDir()),
    },
    { type: 'separator' },
    {
      label: 'Abrir com o Windows',
      type: 'checkbox',
      checked: startupChecked(),
      visible: app.isPackaged,
      click: (item) => applyStartup(item.checked),
    },
    { label: `Atalho: ${shortcutLabel()}`, enabled: false },
    {
      label: 'Sair',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
}

function openFromShortcut() {
  try {
    openWheel();
  } catch (error) {
    log('atalho', error.message);
  }
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const list = [];
  if (shortcutState.keepDefault) list.push(DEFAULT_ACCEL);
  shortcutState.custom.forEach((accel) => {
    if (!list.includes(accel)) list.push(accel);
  });
  const failed = [];
  list.forEach((accel) => {
    const ok = globalShortcut.register(accel, openFromShortcut);
    if (!ok) failed.push(accel);
    log('atalho', ok ? 'ok' : 'falhou', accel);
  });
  paintTray();
  return failed;
}

function wireIpc() {
  ipcMain.handle('pick-file', async (_event, lane) => {
    const picked = await pickFile(lane);
    if (!picked) return null;
    current = picked;
    converter.reset();
    return current;
  });

  ipcMain.handle('begin-convert', async (_event, payload) => {
    const formatId = payload && payload.formatId ? payload.formatId : payload;
    const lane = payload && payload.lane === 'audio' ? 'audio' : 'file';
    if (!current || current.kind === 'none') {
      return { ok: false, error: 'Nenhum arquivo escolhido.' };
    }
    const clash = typeClash(current, lane, formatId);
    if (clash) return { ok: false, error: clash };
    const source = { ...current };
    hideWheel();
    enqueue(source, formatId, lane);
    return { ok: true };
  });

  ipcMain.handle('dismiss-card', () => {
    if (card && !card.isDestroyed()) card.hide();
    return true;
  });

  ipcMain.handle('open-result', () => {
    if (lastSaved && fs.existsSync(lastSaved)) shell.showItemInFolder(lastSaved);
    else shell.openPath(converter.downloadsDir());
    return true;
  });

  ipcMain.handle('open-file', () => {
    if (lastSaved && fs.existsSync(lastSaved)) return shell.openPath(lastSaved);
    return shell.openPath(converter.downloadsDir());
  });

  ipcMain.handle('close-wheel', () => {
    hideWheel();
    return true;
  });

  ipcMain.handle('get-shortcuts', () => shortcutState);

  ipcMain.handle('save-shortcuts', (_event, payload) => {
    const incoming = payload && Array.isArray(payload.custom) ? payload.custom.filter(Boolean) : [];
    const custom = [];
    const rejected = [];
    incoming.slice(0, 1).forEach((accel) => {
      if (validAccel(accel)) custom.push(accel);
      else rejected.push(String(accel));
    });
    if (rejected.length) {
      return { ok: false, error: 'Não consegui usar essa combinação.', failed: rejected, state: shortcutState };
    }
    shortcutState = {
      custom,
      keepDefault: !payload || payload.keepDefault !== false,
    };
    fs.mkdirSync(path.dirname(shortcutsFile()), { recursive: true });
    fs.writeFileSync(shortcutsFile(), JSON.stringify(shortcutState));
    const failed = registerHotkeys();
    return { ok: failed.length === 0, failed: failed.map(prettyAccel), state: shortcutState };
  });

  ipcMain.handle('reset-shortcuts', () => {
    shortcutState = { custom: [], keepDefault: true };
    fs.mkdirSync(path.dirname(shortcutsFile()), { recursive: true });
    fs.writeFileSync(shortcutsFile(), JSON.stringify(shortcutState));
    registerHotkeys();
    return shortcutState;
  });
}

async function runSelfTest() {
  const results = [];
  async function check(name, source, formatId) {
    try {
      converter.reset();
      const output = await converter.convert(source, formatId);
      const size = fs.statSync(output.path).size;
      results.push({ name, format: formatId, ok: size > 16, size, path: output.path });
      log('ok', name, formatId, size);
    } catch (error) {
      results.push({ name, format: formatId, ok: false, error: error.message });
      log('falha', name, formatId, error.stack || error.message);
    }
  }

  const docx = {
    kind: 'file',
    name: 'Exemplo.docx',
    path: samplePath,
    saved: true,
    ext: '.docx',
  };
  for (const formatId of ['pdf', 'png', 'jpg', 'svg', 'txt', 'html', 'rtf', 'docx']) {
    await check('docx', docx, formatId);
  }

  const pngPath = path.join(__dirname, 'exemplos', 'Exemplo.png');
  if (fs.existsSync(pngPath)) {
    const image = { kind: 'file', name: 'Exemplo.png', path: pngPath, saved: true, ext: '.png' };
    for (const formatId of ['jpg', 'pdf', 'svg', 'docx']) {
      await check('png', image, formatId);
    }
  }

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify(results, null, 2));
  return failed.length ? 1 : 0;
}

if (process.platform === 'win32') app.setAppUserModelId('com.converts.arquivos');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    try {
      openWheel();
    } catch (error) {
      log('segunda instancia', error.message);
    }
  });

  app.whenReady().then(async () => {
    samplePath = await ensureSample();
    wireIpc();
    createWindow();
    createCard();
    if (process.argv.includes('--pdftext')) {
      const file = process.argv[process.argv.indexOf('--pdftext') + 1];
      const started = Date.now();
      const output = await converter.convert({
        kind: 'file',
        name: path.basename(file),
        path: file,
        saved: true,
        ext: '.pdf',
      }, 'txt');
      const body = fs.readFileSync(output.path, 'utf8');
      console.log(JSON.stringify({
        ms: Date.now() - started,
        size: body.length,
        preview: body.slice(0, 180),
      }));
      quitting = true;
      app.exit(0);
      return;
    }
    if (process.argv.includes('--quick')) {
      const source = {
        kind: 'file',
        name: 'Exemplo.docx',
        path: samplePath,
        saved: true,
        ext: '.docx',
      };
      const started = Date.now();
      const times = {};
      for (const formatId of ['txt', 'html', 'pdf', 'png']) {
        const mark = Date.now();
        const output = await converter.convert(source, formatId);
        times[formatId] = { ms: Date.now() - mark, size: fs.statSync(output.path).size };
      }
      log('quick', JSON.stringify(times), 'total', Date.now() - started);
      console.log(JSON.stringify(times));
      quitting = true;
      app.exit(0);
      return;
    }
    if (process.argv.includes('--test')) {
      win.webContents.once('did-finish-load', async () => {
        const code = await runSelfTest();
        quitting = true;
        app.exit(code);
      });
      return;
    }
    runOffice('probe', {}, log, 1800)
      .then(rememberProbe)
      .catch((error) => log('probe', error.message))
      .finally(() => armWatch());
    ensureRaster().catch((error) => log('raster', error.message));
    try { require('mammoth'); } catch (error) { log('mammoth', error.message); }
    ensureStartup();
    shortcutState = loadShortcuts();
    createTray();
    const failedShortcuts = registerHotkeys();
    const registered = failedShortcuts.length === 0;
    if (process.argv.includes('--demo')) {
      win.webContents.once('did-finish-load', () => {
        current = {
          kind: 'file',
          name: 'Exemplo.docx',
          path: samplePath,
          saved: true,
          ext: '.docx',
        };
        reveal(current);
      });
    }
    if (registered && tray) {
      const tip = path.join(app.getPath('userData'), 'converts-tip');
      if (!fs.existsSync(tip)) {
        fs.mkdirSync(path.dirname(tip), { recursive: true });
        fs.writeFileSync(tip, '1');
        tray.displayBalloon({
          title: 'Converts',
          content: 'Estou na bandeja. Atalho: Ctrl+Shift+Espaço',
        });
      }
    }
    log('pronta', registered ? 'atalho ok' : 'atalho falhou');
  });

  app.on('window-all-closed', () => {});

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
