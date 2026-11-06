const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scriptPath = path.join(__dirname, 'office.ps1');

const MESSAGES = {
  WORD_NOT_OPEN: 'O Word não está aberto com um documento.',
  EXCEL_NOT_OPEN: 'O Excel não está aberto com uma planilha.',
  PPT_NOT_OPEN: 'O PowerPoint não está aberto com uma apresentação.',
  NEED_TEXT: 'Esse formato sai a partir do texto do arquivo.',
  NO_OFFICE: 'O Office não abre esse tipo de arquivo.',
  BAD_TARGET: 'Formato de saída desconhecido.',
  EMPTY_OUTPUT: 'A conversão não gerou o arquivo.',
};

function humanize(error) {
  const raw = String(error || '').trim();
  const first = raw.split(/\r?\n/)[0].trim();
  if (MESSAGES[first]) return MESSAGES[first];
  if (MESSAGES[raw]) return MESSAGES[raw];
  if (/NEED_TEXT/.test(raw)) return MESSAGES.NEED_TEXT;
  return first.slice(0, 220) || 'O Office não conseguiu converter.';
}

let host = null;
let hostReady = null;
let hostBuffer = '';
let hostSeq = 0;
const hostWaiters = new Map();

function dropHost(error) {
  const current = host;
  host = null;
  hostReady = null;
  hostBuffer = '';
  for (const waiter of hostWaiters.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(error || new Error('A consulta do Office fechou.'));
  }
  hostWaiters.clear();
  if (current && !current.killed) current.kill();
}

function startHost() {
  if (host && host.exitCode == null && !host.killed) return hostReady;
  hostBuffer = '';
  host = spawn(
    'powershell.exe',
    ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    {
      env: { ...process.env, RODA_HOST: '1', RODA_ACTION: '', RODA_RESULT: '' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );
  hostReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Não consegui preparar a leitura da janela.'));
      dropHost();
    }, 8000);
    host._markReady = () => {
      clearTimeout(timer);
      resolve();
    };
    host.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  host.stdout.on('data', (chunk) => {
    hostBuffer += chunk.toString('utf8');
    let index = hostBuffer.indexOf('\n');
    while (index >= 0) {
      const line = hostBuffer.slice(0, index).replace(/^\uFEFF/, '').trim();
      hostBuffer = hostBuffer.slice(index + 1);
      index = hostBuffer.indexOf('\n');
      if (!line) continue;
      let message = null;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.ready && host && host._markReady) {
        host._markReady();
        host._markReady = null;
        continue;
      }
      const waiter = hostWaiters.get(message.id);
      if (!waiter) continue;
      hostWaiters.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.ok) waiter.resolve(message);
      else {
        const error = new Error(humanize(message.error || 'OFFICE_FAILED'));
        error.office = true;
        waiter.reject(error);
      }
    }
  });
  host.on('exit', () => {
    if (host && host.exitCode != null) dropHost(new Error('A consulta do Office fechou.'));
  });
  return hostReady;
}

function runOffice(action, vars = {}, log = () => {}, timeoutMs) {
  const id = ++hostSeq;
  const limit = timeoutMs || (action === 'probe' ? 2500 : 20000);
  return startHost().then(() => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostWaiters.delete(id);
      reject(new Error(action === 'probe' ? 'Não consegui ler a janela ativa.' : 'A conversão pelo Office demorou demais.'));
      if (action !== 'probe') dropHost();
    }, limit);
    hostWaiters.set(id, { resolve, reject, timer });
    try {
      host.stdin.write(`${JSON.stringify({ id, action, vars })}\n`);
    } catch (error) {
      clearTimeout(timer);
      hostWaiters.delete(id);
      reject(error);
    }
  })).catch((error) => {
    log('office', error.message);
    throw error;
  });
}

module.exports = { runOffice, humanize };
