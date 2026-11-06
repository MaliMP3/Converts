const CX = 500;
const CY = 500;
const R_OUT = 430;
const R_IN = 268;
const R_ARC = 448;
const ICON_R = (R_OUT + R_IN) / 2;

const FORMATS = [
  { id: 'pdf', label: 'PDF', ext: '.pdf' },
  { id: 'docx', label: 'Word', ext: '.docx' },
  { id: 'png', label: 'PNG', ext: '.png' },
  { id: 'jpg', label: 'JPEG', ext: '.jpg' },
  { id: 'svg', label: 'SVG', ext: '.svg' },
  { id: 'html', label: 'HTML', ext: '.html' },
  { id: 'txt', label: 'Texto', ext: '.txt' },
  { id: 'rtf', label: 'RTF', ext: '.rtf' },
];

const MEDIA = [
  { id: 'mp3', label: 'MP3', ext: '.mp3' },
  { id: 'wav', label: 'WAV', ext: '.wav' },
  { id: 'm4a', label: 'M4A', ext: '.m4a' },
  { id: 'flac', label: 'FLAC', ext: '.flac' },
  { id: 'ogg', label: 'OGG', ext: '.ogg' },
  { id: 'mp4', label: 'MP4', ext: '.mp4' },
  { id: 'mkv', label: 'MKV', ext: '.mkv' },
  { id: 'webm', label: 'WEBM', ext: '.webm' },
];

const GATES = [
  { id: 'file', label: 'Arquivo' },
  { id: 'audio', label: 'Áudio' },
];

const MEDIA_EXT = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wma',
  '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi',
]);

const state = {
  index: 0,
  lane: 'gate',
  source: { kind: 'none', name: '' },
  busy: false,
  message: '',
  bad: false,
};

function options() {
  if (state.lane === 'audio') return MEDIA;
  if (state.lane === 'file') return FORMATS;
  return GATES;
}

function spin() {
  return state.lane === 'gate' ? -Math.PI / 2 : 0;
}

const wheel = document.getElementById('wheel');
const label = document.getElementById('label');
const count = document.getElementById('count');
const fileLine = document.getElementById('file');
const hint = document.getElementById('hint');
let shownIndex = -1;
let arcState = { a0: 0, a1: 0.4 };
let arcFrame = 0;

function polar(cx, cy, r, angle) {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

function segmentAngles(index, total) {
  const slice = (Math.PI * 2) / total;
  const gap = total <= 2 ? 0.05 : 0.018;
  const start = index * slice - slice / 2 + spin();
  return [start + gap, start + slice - gap];
}

function donut(a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(CX, CY, R_OUT, a0);
  const [x1, y1] = polar(CX, CY, R_OUT, a1);
  const [x2, y2] = polar(CX, CY, R_IN, a1);
  const [x3, y3] = polar(CX, CY, R_IN, a0);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R_OUT} ${R_OUT} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${R_IN} ${R_IN} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

function arc(a0, a1) {
  const [x0, y0] = polar(CX, CY, R_ARC, a0);
  const [x1, y1] = polar(CX, CY, R_ARC, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R_ARC} ${R_ARC} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function mark(index, format, total) {
  const [a0, a1] = segmentAngles(index, total);
  const mid = (a0 + a1) / 2;
  const [x, y] = polar(CX, CY, ICON_R, mid);
  const size = total <= 2 ? 40 : format.label.length > 4 ? 28 : 34;
  return `
    <g class="mark" data-i="${index}">
      <text class="slice-label" x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" font-size="${size}">${format.label}</text>
    </g>
  `;
}

function glideArc(a0, a1, instant) {
  const target0 = shownIndex < 0 ? a0 : a0 + Math.round((arcState.a0 - a0) / (Math.PI * 2)) * Math.PI * 2;
  let delta = a0 - target0;
  const from0 = instant ? target0 : arcState.a0;
  const from1 = instant ? a1 + (target0 - a0) : arcState.a1;
  const to0 = a0 - delta;
  const to1 = a1 - delta;
  const started = performance.now();
  const duration = instant ? 0 : 220;
  cancelAnimationFrame(arcFrame);
  const step = (now) => {
    const t = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - t) ** 3;
    arcState.a0 = from0 + (to0 - from0) * eased;
    arcState.a1 = from1 + (to1 - from1) * eased;
    const path = document.getElementById('arc');
    if (path) path.setAttribute('d', arc(arcState.a0, arcState.a1));
    if (t < 1) arcFrame = requestAnimationFrame(step);
  };
  arcFrame = requestAnimationFrame(step);
}

function build() {
  const list = options();
  const slices = list.map((_, index) => {
    const [a0, a1] = segmentAngles(index, list.length);
    return `<path class="slice" data-i="${index}" d="${donut(a0, a1)}" fill="url(#idle)"/>`;
  }).join('');
  const marks = list.map((format, index) => mark(index, format, list.length)).join('');

  wheel.innerHTML = `
    <defs>
      <radialGradient id="idle" cx="50%" cy="50%" r="64%">
        <stop offset="62%" stop-color="#4a4a4a"/>
        <stop offset="100%" stop-color="#5c5c5c"/>
      </radialGradient>
      <radialGradient id="active" cx="50%" cy="42%" r="72%">
        <stop offset="0%" stop-color="#dcdcdc"/>
        <stop offset="100%" stop-color="#f6f6f6"/>
      </radialGradient>
      <filter id="lift" x="-18%" y="-18%" width="136%" height="136%">
        <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.38"/>
      </filter>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.4" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <g filter="url(#lift)">
      <g id="slices">${slices}</g>
      <circle cx="500" cy="500" r="${R_IN}" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="3"/>
    </g>
    <path id="arc" fill="none" filter="url(#glow)"/>
    <g id="marks">${marks}</g>
  `;
}

function sourceName() {
  if (!state.source || state.source.kind === 'none' || !state.source.name) return 'Nenhum arquivo aberto';
  return state.source.name;
}

function paint() {
  const list = options();
  const format = list[state.index];
  label.textContent = state.busy ? 'Salvando' : state.bad ? 'Erro' : format.label;
  count.textContent = `${state.index + 1} / ${list.length}`;
  fileLine.textContent = state.message || sourceName();
  fileLine.classList.toggle('bad', state.bad);
  document.querySelectorAll('.mark').forEach((markNode) => {
    markNode.classList.toggle('on', Number(markNode.dataset.i) === state.index);
  });
  document.querySelectorAll('.slice').forEach((slice) => {
    const on = Number(slice.dataset.i) === state.index;
    slice.classList.toggle('on', on);
    slice.setAttribute('fill', on ? 'url(#active)' : 'url(#idle)');
    if (on) slice.parentElement.appendChild(slice);
  });
  const [a0, a1] = segmentAngles(state.index, list.length);
  const pad = list.length <= 2 ? 0.08 : 0.06;
  const instant = shownIndex < 0;
  shownIndex = state.index;
  glideArc(a0 + pad, a1 - pad, instant);
  const empty = !state.source || state.source.kind === 'none';
  if (state.lane === 'gate') hint.textContent = 'Escolha Arquivo ou Áudio · Esc fecha';
  else if (empty) hint.textContent = 'Clique para escolher e baixar · Esc volta';
  else hint.textContent = 'Mova para escolher · Clique para baixar · Esc volta';
}

function geometry() {
  const rect = wheel.getBoundingClientRect();
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.top + rect.height / 2,
    outer: (rect.width / 1000) * R_OUT,
    inner: (rect.width / 1000) * R_IN,
  };
}

function hitTest(x, y) {
  const box = geometry();
  const dx = x - box.cx;
  const dy = y - box.cy;
  const dist = Math.hypot(dx, dy);
  if (dist > box.outer * 1.22) return { zone: 'outside' };
  if (dist < box.inner * 0.62) return { zone: 'center' };
  let angle = Math.atan2(dx, -dy);
  if (angle < 0) angle += Math.PI * 2;
  const total = options().length;
  const slice = (Math.PI * 2) / total;
  const shifted = (angle - spin() + slice / 2 + Math.PI * 8) % (Math.PI * 2);
  const index = Math.floor(shifted / slice) % total;
  return { zone: 'segment', index };
}

function select(index) {
  if (state.busy) return;
  state.index = (index + options().length) % options().length;
  state.message = '';
  state.bad = false;
  paint();
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg']);

function sourceFits(source) {
  if (!source || source.kind === 'none') return false;
  const ext = (source.ext || '').toLowerCase();
  const media = MEDIA_EXT.has(ext);
  return state.lane === 'audio' ? media : !media;
}

function typeClash(source, lane, formatId) {
  if (!source || source.kind === 'none') return '';
  const ext = (source.ext || '').toLowerCase();
  if (lane === 'audio' && IMAGE_EXT.has(ext)) return 'Não dá para converter imagem em áudio.';
  const imageTarget = formatId === 'png' || formatId === 'jpg' || formatId === 'svg';
  if (lane === 'file' && MEDIA_EXT.has(ext) && imageTarget) return 'Não dá para converter áudio em imagem.';
  return '';
}

function setLane(lane) {
  state.lane = lane;
  state.index = 0;
  state.message = '';
  state.bad = false;
  shownIndex = -1;
  build();
  paint();
}

function openWith(source) {
  state.source = source || { kind: 'none', name: '' };
  state.busy = false;
  state.message = '';
  state.bad = false;
  document.body.classList.remove('idle');
  document.body.classList.add('show');
  setLane('gate');
}

async function confirm() {
  if (state.busy) return;
  const format = options()[state.index];
  if (state.lane === 'gate') {
    setLane(format.id);
    return;
  }
  if (!window.converts) {
    state.bad = false;
    state.message = 'Visual de teste. Abra pelo atalho no app.';
    paint();
    label.textContent = format.label;
    return;
  }
  try {
    const clash = typeClash(state.source, state.lane, format.id);
    if (clash) {
      state.bad = true;
      state.message = clash;
      paint();
      return;
    }
    if (!sourceFits(state.source)) {
      state.message = 'Escolha o arquivo…';
      state.bad = false;
      paint();
      label.textContent = format.label;
      const picked = await window.converts.pick(state.lane);
      if (!picked) {
        state.message = '';
        paint();
        return;
      }
      state.source = picked;
      paint();
    }
    const started = await window.converts.beginConvert(format.id, state.lane);
    if (!started || started.ok === false) {
      state.bad = true;
      state.message = (started && started.error) || 'Não consegui converter.';
      paint();
      return;
    }
    closeWheel();
  } catch (error) {
    state.busy = false;
    state.bad = true;
    document.body.classList.remove('busy');
    state.message = error.message || 'Não consegui converter.';
    paint();
  }
}

function closeWheel() {
  if (state.busy) return;
  hideHotkeys();
  document.body.classList.remove('show');
  if (window.converts) {
    setTimeout(() => window.converts.close(), 160);
  }
}

const hotkeyBtn = document.getElementById('hotkey-btn');
const hotkeys = document.getElementById('hotkeys');
const hotkeyList = document.getElementById('hotkey-list');
const keepDefault = document.getElementById('keep-default');
const hotkeyNote = document.getElementById('hotkey-note');
let hotkeyCards = [''];
let listening = -1;

function prettyAccel(accel) {
  if (!accel) return 'Clique e pressione as teclas';
  return accel
    .replace(/CommandOrControl|Control|Ctrl/g, 'Ctrl')
    .replace(/Space/g, 'Espaço')
    .split('+')
    .join(' + ');
}

function note(text, bad) {
  hotkeyNote.textContent = text || '';
  hotkeyNote.classList.toggle('bad', !!bad);
}

function renderHotkeys() {
  const accel = hotkeyCards[0] || '';
  hotkeyList.innerHTML = `<div class="hotkey-card">
      <button class="capture${listening === 0 ? ' listening' : ''}" type="button" data-capture="0">${prettyAccel(accel)}</button>
      <button class="save" type="button" data-save="0">Salvar novo atalho</button>
    </div>`;
}

function hideHotkeys() {
  listening = -1;
  if (hotkeys) hotkeys.hidden = true;
}

function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const names = {
    Space: 'Space',
    Tab: 'Tab',
    Escape: 'Esc',
    Enter: 'Return',
    NumpadEnter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec',
  };
  return names[code] || '';
}

function comboFromEvent(event) {
  if (event.repeat) return { waiting: true };
  const mods = [];
  if (event.ctrlKey || event.metaKey) mods.push('CommandOrControl');
  if (event.altKey) mods.push('Alt');
  if (event.shiftKey) mods.push('Shift');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return { waiting: true };
  const main = keyFromCode(event.code);
  if (!main) return { error: 'Essa tecla não serve para atalho.' };
  if (!mods.length) return { error: 'Use Ctrl, Alt ou Shift junto com outra tecla.' };
  if (mods.length + 1 > 3) return { error: 'No máximo 3 teclas.' };
  return { accel: [...mods, main].join('+') };
}

async function saveHotkeys() {
  const custom = hotkeyCards.filter(Boolean);
  if (!custom.length && keepDefault && !keepDefault.checked) {
    note('Defina um atalho ou mantenha Ctrl+Shift+Espaço.', true);
    return;
  }
  const result = await window.converts.saveShortcuts(custom, keepDefault.checked);
  if (!result || result.ok === false) {
    const reason = (result && (result.error || (result.failed || []).join(', '))) || 'esse atalho';
    note(`Não consegui registrar ${reason}.`, true);
    return;
  }
  hotkeyCards = result.state.custom.length ? result.state.custom.slice() : [''];
  keepDefault.checked = result.state.keepDefault !== false;
  listening = -1;
  renderHotkeys();
  note('Atalho salvo.');
}

document.addEventListener('mousemove', (event) => {
  if (!document.body.classList.contains('show') || state.busy) return;
  if (event.target.closest('#hotkeys, #hotkey-btn')) return;
  const hit = hitTest(event.clientX, event.clientY);
  if (hit.zone === 'segment' && hit.index !== state.index) select(hit.index);
});

document.getElementById('shortcut-dock').addEventListener('click', (event) => {
  event.stopPropagation();
});

document.addEventListener('click', (event) => {
  if (!document.body.classList.contains('show')) return;
  if (event.target.closest('#shortcut-dock')) return;
  const cycle = event.target.closest('[data-cycle]');
  if (cycle) {
    select(state.index + Number(cycle.dataset.cycle));
    return;
  }
  const hit = hitTest(event.clientX, event.clientY);
  if (hit.zone === 'outside') closeWheel();
  else confirm();
});

hotkeyBtn.addEventListener('click', async () => {
  if (!hotkeys.hidden) {
    hideHotkeys();
    return;
  }
  if (window.converts && window.converts.getShortcuts) {
    const state = await window.converts.getShortcuts();
    hotkeyCards = state.custom && state.custom.length ? [state.custom[0]] : [''];
    keepDefault.checked = state.keepDefault !== false;
  }
  listening = -1;
  note('');
  renderHotkeys();
  hotkeys.hidden = false;
});

document.getElementById('hotkeys-close').addEventListener('click', hideHotkeys);

hotkeyList.addEventListener('click', (event) => {
  const capture = event.target.closest('[data-capture]');
  const save = event.target.closest('[data-save]');
  if (capture) {
    listening = Number(capture.dataset.capture);
    note('Pressione até 3 teclas. Esc cancela.');
    renderHotkeys();
    return;
  }
  if (save) {
    const index = Number(save.dataset.save);
    if (!hotkeyCards[index]) {
      note('Defina as teclas antes de salvar.', true);
      return;
    }
    saveHotkeys();
  }
});

keepDefault.addEventListener('change', () => {
  if (window.converts) saveHotkeys();
});

document.getElementById('hotkey-reset').addEventListener('click', async () => {
  if (!window.converts) return;
  const state = await window.converts.resetShortcuts();
  hotkeyCards = [''];
  keepDefault.checked = state.keepDefault !== false;
  listening = -1;
  renderHotkeys();
  note('Atalhos voltaram para Ctrl+Shift+Espaço.');
});

window.addEventListener('keydown', (event) => {
  if (!document.body.classList.contains('show')) return;
  if (listening >= 0) {
    event.preventDefault();
    if (event.key === 'Escape') {
      listening = -1;
      renderHotkeys();
      note('');
      return;
    }
    const combo = comboFromEvent(event);
    if (combo.waiting) return;
    if (combo.error) {
      note(combo.error, true);
      return;
    }
    hotkeyCards[listening] = combo.accel;
    listening = -1;
    renderHotkeys();
    note('Clique em Salvar novo atalho.');
    return;
  }
  if (event.key === 'Escape') {
    if (!hotkeys.hidden) hideHotkeys();
    else if (state.lane !== 'gate') setLane('gate');
    else closeWheel();
  } else if (hotkeys.hidden && event.key === 'Enter') confirm();
  else if (hotkeys.hidden && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) select(state.index + 1);
  else if (hotkeys.hidden && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) select(state.index - 1);
  else if (hotkeys.hidden && event.key >= '1' && event.key <= String(options().length)) select(Number(event.key) - 1);
});

window.addEventListener('contextmenu', (event) => event.preventDefault());

build();
paint();

if (window.converts) {
  window.converts.onOpen((payload) => openWith(payload.source));
} else {
  openWith({ kind: 'file', name: 'Exemplo.docx', ext: '.docx', saved: true, path: '' });
}
