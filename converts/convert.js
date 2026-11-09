const fs = require('fs');
const os = require('os');
const path = require('path');

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

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg']);
const WORD_EXT = new Set(['.doc', '.docx', '.docm', '.rtf', '.odt', '.txt', '.html', '.htm', '.pdf']);
const EXCEL_EXT = new Set(['.xls', '.xlsx', '.xlsm', '.csv']);
const PPT_EXT = new Set(['.ppt', '.pptx', '.ppsx']);

function createConverter({ runOffice, renderPdf, htmlToPdf, log }) {
  const pdfCache = new Map();
  const rasterCache = new Map();
  const textCache = new Map();
  const pdfLayoutCache = new Map();

  function reset() {
    pdfCache.clear();
    rasterCache.clear();
    textCache.clear();
    pdfLayoutCache.clear();
  }

  function tempPath(ext) {
    const dir = path.join(os.tmpdir(), 'converts-arquivos');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }

  function downloadsDir() {
    const home = os.homedir();
    const downloads = path.join(home, 'Downloads');
    const dir = path.join(fs.existsSync(downloads) ? downloads : home, 'Converts');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function safeBase(name) {
    const base = path.parse(name || 'arquivo').name || 'arquivo';
    const clean = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    return (clean || 'arquivo').slice(0, 80);
  }

  function destPath(source, ext) {
    const dir = downloadsDir();
    let file = path.join(dir, `${safeBase(source.name)}${ext}`);
    const same =
      source.path && path.resolve(file).toLowerCase() === path.resolve(source.path).toLowerCase();
    if (same || fs.existsSync(file)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      file = path.join(dir, `${safeBase(source.name)}-${stamp}${ext}`);
    }
    return file;
  }

  function shortPath(file) {
    const home = os.homedir();
    const normalized = path.normalize(file);
    if (normalized.toLowerCase().startsWith(home.toLowerCase())) {
      return normalized.slice(home.length).replace(/^[/\\]/, '');
    }
    return normalized;
  }

  async function office(source, target, dest) {
    fs.rmSync(dest, { force: true });
    return runOffice('convert', {
      CONVERTS_KIND: source.kind,
      CONVERTS_PATH: source.path || '',
      CONVERTS_EXT: source.ext || '',
      CONVERTS_TARGET: target,
      CONVERTS_DEST: dest,
    });
  }

  function isLive(source) {
    return String(source.kind || '').endsWith('-live');
  }

  function needsOffice(source) {
    if (isLive(source)) return true;
    const ext = (source.ext || '').toLowerCase();
    return ext === '.doc' || ext === '.docm' || ext === '.odt' || EXCEL_EXT.has(ext) || PPT_EXT.has(ext);
  }

  async function ensurePdf(source) {
    const key = `${source.kind}|${source.path}|${source.name}`;
    if (pdfCache.has(key)) return pdfCache.get(key);
    const ext = (source.ext || '').toLowerCase();
    let pdf;
    if (source.kind === 'file' && ext === '.pdf' && source.path && fs.existsSync(source.path)) {
      pdf = source.path;
    } else if (IMAGE_EXT.has(ext) && source.path) {
      pdf = tempPath('.pdf');
      await imageToPdf(source.path, pdf);
    } else if (needsOffice(source)) {
      pdf = tempPath('.pdf');
      try {
        await office(source, 'pdf', pdf);
      } catch (error) {
        log('pdf via office falhou', error.message);
        const text = await readPlainText(source, { skipOffice: true });
        await textToPdf(text, pdf);
      }
    } else if (ext === '.docx' || ext === '.txt' || ext === '.html' || ext === '.htm' || ext === '.rtf') {
      pdf = tempPath('.pdf');
      await writeFastPdf(source, pdf);
    } else {
      pdf = tempPath('.pdf');
      const text = await readPlainText(source, { skipOffice: true });
      await textToPdf(text, pdf);
    }
    if (!fs.existsSync(pdf) || fs.statSync(pdf).size < 32) {
      throw new Error('Não consegui montar o PDF desse arquivo.');
    }
    pdfCache.set(key, pdf);
    return pdf;
  }

  async function readPlainText(source, { skipOffice = false } = {}) {
    const ext = (source.ext || '').toLowerCase();
    if (!skipOffice && isLive(source) && ext !== '.pdf') {
      const file = tempPath('.txt');
      try {
        await office(source, 'text', file);
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
      } catch (error) {
        log('texto via office falhou', error.message);
      }
    }
    if (source.path && fs.existsSync(source.path)) {
      if (ext === '.txt' || ext === '.csv' || ext === '.rtf' || ext === '.svg') {
        return fs.readFileSync(source.path, 'utf8').replace(/<[^>]+>/g, ' ');
      }
      if (ext === '.html' || ext === '.htm') {
        return fs.readFileSync(source.path, 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (ext === '.docx') {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: source.path });
          if (result.value) return result.value;
        } catch (error) {
          log('mammoth falhou', error.message);
        }
      }
      if (ext === '.pdf') {
        const layout = await readPdfLayout(source);
        return layout.text;
      }
    }
    if (IMAGE_EXT.has(ext)) {
      return `Imagem: ${source.name || path.basename(source.path || 'imagem')}`;
    }
    return source.name || 'Arquivo';
  }

  async function readPdfLayout(source) {
    const key = source.path || source.name || '';
    if (pdfLayoutCache.has(key)) return pdfLayoutCache.get(key);
    const info = await renderPdf(source.path, { textOnly: true });
    const text = String((info && info.text) || '').replace(/\u0000/g, '').trim();
    if (!text) {
      throw new Error('Esse PDF não tem texto selecionável. Se a página for uma imagem, escolha PNG ou JPEG.');
    }
    const layout = {
      text,
      html: String((info && info.html) || ''),
      pages: (info && info.pages) || 1,
    };
    pdfLayoutCache.set(key, layout);
    textCache.set(key, text);
    return layout;
  }

  async function rasterize(pdfPath) {
    if (rasterCache.has(pdfPath)) return rasterCache.get(pdfPath);
    const outputs = {
      png: tempPath('.png'),
      jpg: tempPath('.jpg'),
      svg: tempPath('.svg'),
      txt: tempPath('.txt'),
    };
    const info = await renderPdf(pdfPath, outputs);
    const text = info.text || (fs.existsSync(outputs.txt) ? fs.readFileSync(outputs.txt, 'utf8') : '');
    const result = {
      png: outputs.png,
      jpg: outputs.jpg,
      svg: outputs.svg,
      text,
      html: info.html || '',
      pages: info.pages || 1,
    };
    rasterCache.set(pdfPath, result);
    if (pdfPath) {
      pdfLayoutCache.set(pdfPath, { text, html: result.html, pages: result.pages });
      textCache.set(pdfPath, text);
    }
    return result;
  }

  async function convert(source, formatId) {
    const format = FORMATS.find((item) => item.id === formatId);
    if (!format) throw new Error('Formato desconhecido.');
    if (!source || source.kind === 'none') throw new Error('Nenhum arquivo escolhido.');
    const dest = destPath(source, format.ext);
    const ext = (source.ext || '').toLowerCase();

    if (IMAGE_EXT.has(ext) && source.kind === 'file') {
      await convertImage(source, formatId, dest);
    } else if (formatId === 'png' || formatId === 'jpg' || formatId === 'svg') {
      const pdf = await ensurePdf(source);
      const rendered = await rasterize(pdf);
      const from = formatId === 'png' ? rendered.png : formatId === 'jpg' ? rendered.jpg : rendered.svg;
      fs.copyFileSync(from, dest);
    } else if (formatId === 'pdf') {
      const pdf = await ensurePdf(source);
      if (path.resolve(pdf) !== path.resolve(dest)) fs.copyFileSync(pdf, dest);
    } else {
      await convertDocument(source, formatId, dest);
    }

    if (!fs.existsSync(dest) || fs.statSync(dest).size < 8) {
      throw new Error('A conversão terminou sem gerar o arquivo.');
    }
    return {
      path: dest,
      shortPath: shortPath(dest),
      label: format.label,
    };
  }

  async function docxToHtml(source) {
    const mammoth = require('mammoth');
    const result = await mammoth.convertToHtml({ path: source.path });
    return wrapHtml(source.name || 'Documento', result.value || '<p></p>');
  }

  function textFileToHtml(source) {
    const ext = (source.ext || '').toLowerCase();
    const raw = fs.readFileSync(source.path, 'utf8');
    if (ext === '.html' || ext === '.htm') return raw;
    return textToHtml(source.name || 'Arquivo', raw);
  }

  async function writeFastDocument(source, formatId, dest) {
    const ext = (source.ext || '').toLowerCase();
    if (ext === '.txt' && formatId === 'txt') {
      fs.copyFileSync(source.path, dest);
      return;
    }
    if ((ext === '.html' || ext === '.htm') && formatId === 'html') {
      fs.copyFileSync(source.path, dest);
      return;
    }
    if (ext === '.rtf' && formatId === 'rtf') {
      fs.copyFileSync(source.path, dest);
      return;
    }
    if (formatId === 'html') {
      const html = ext === '.docx' ? await docxToHtml(source) : textFileToHtml(source);
      fs.writeFileSync(dest, html, 'utf8');
      return;
    }
    const text = await readPlainText(source, { skipOffice: true });
    if (formatId === 'txt') {
      fs.writeFileSync(dest, text, 'utf8');
      return;
    }
    if (formatId === 'rtf') {
      fs.writeFileSync(dest, textToRtf(text), 'utf8');
      return;
    }
    if (formatId === 'docx') {
      await textToDocx(text, dest);
    }
  }

  async function writeFastPdf(source, dest) {
    const ext = (source.ext || '').toLowerCase();
    try {
      const html = ext === '.docx' ? await docxToHtml(source) : textFileToHtml(source);
      if (htmlToPdf) {
        await htmlToPdf(html, dest);
        return;
      }
    } catch (error) {
      log('pdf rápido falhou', error.message);
    }
    const text = await readPlainText(source, { skipOffice: true });
    await textToPdf(text, dest);
  }

  async function convertDocument(source, formatId, dest) {
    const ext = (source.ext || '').toLowerCase();
    if (!isLive(source) && ext === '.docx' && formatId === 'docx') {
      fs.copyFileSync(source.path, dest);
      return;
    }
    if (!isLive(source) && (ext === '.docx' || ext === '.txt' || ext === '.html' || ext === '.htm' || ext === '.rtf')) {
      await writeFastDocument(source, formatId, dest);
      return;
    }
    if (!isLive(source) && ext === '.pdf' && (formatId === 'txt' || formatId === 'html' || formatId === 'rtf' || formatId === 'docx')) {
      const layout = await readPdfLayout(source);
      if (formatId === 'txt') {
        fs.writeFileSync(dest, layout.text, 'utf8');
        return;
      }
      if (formatId === 'html') {
        fs.writeFileSync(dest, layout.html || textToHtml(source.name || 'Arquivo', layout.text), 'utf8');
        return;
      }
      if (formatId === 'rtf') {
        fs.writeFileSync(dest, textToRtf(layout.text), 'utf8');
        return;
      }
      if (formatId === 'docx') {
        await textToDocx(layout.text, dest);
        return;
      }
    }
    if (needsOffice(source)) {
      try {
        await office(source, formatId, dest);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
      } catch (error) {
        log(`office ${formatId} falhou`, error.message);
      }
    }
    const text = await readPlainText(source, { skipOffice: !isLive(source) });
    if (formatId === 'txt') {
      fs.writeFileSync(dest, text, 'utf8');
      return;
    }
    if (formatId === 'html') {
      fs.writeFileSync(dest, textToHtml(source.name || 'Arquivo', text), 'utf8');
      return;
    }
    if (formatId === 'rtf') {
      fs.writeFileSync(dest, textToRtf(text), 'utf8');
      return;
    }
    if (formatId === 'docx') {
      await textToDocx(text, dest);
      return;
    }
    throw new Error('Não consegui converter para esse formato.');
  }

  async function convertImage(source, formatId, dest) {
    const file = source.path;
    if (formatId === 'svg' && (source.ext || '').toLowerCase() === '.svg') {
      fs.copyFileSync(file, dest);
      return;
    }
    if (formatId === 'txt') {
      fs.writeFileSync(dest, `Imagem: ${source.name}\r\n`, 'utf8');
      return;
    }
    const png = tempPath('.png');
    const { width, height, buffer } = await rasterImage(file, png);
    if (formatId === 'png') {
      fs.copyFileSync(png, dest);
      return;
    }
    if (formatId === 'jpg') {
      const { nativeImage } = require('electron');
      const image = nativeImage.createFromPath(png);
      fs.writeFileSync(dest, image.toJPEG(92));
      return;
    }
    if (formatId === 'svg') {
      fs.writeFileSync(dest, pngToSvg(buffer || fs.readFileSync(png), width, height), 'utf8');
      return;
    }
    if (formatId === 'pdf') {
      await imageToPdf(png, dest);
      return;
    }
    if (formatId === 'html') {
      const b64 = (buffer || fs.readFileSync(png)).toString('base64');
      const inner = `<img alt="${escapeHtml(source.name)}" src="data:image/png;base64,${b64}">`;
      fs.writeFileSync(dest, wrapHtml(source.name, inner), 'utf8');
      return;
    }
    if (formatId === 'docx') {
      await imageToDocx(png, width, height, dest);
      return;
    }
    if (formatId === 'rtf') {
      fs.writeFileSync(dest, textToRtf(`Imagem: ${source.name}`), 'utf8');
      return;
    }
  }

  function outputPath(source, ext) {
    const file = destPath(source, ext);
    return { path: file, shortPath: shortPath(file) };
  }

  return { convert, reset, formats: FORMATS, downloadsDir, outputPath };
}

async function rasterImage(file, pngDest) {
  const { nativeImage } = require('electron');
  let image = nativeImage.createFromPath(file);
  if (image.isEmpty() && path.extname(file).toLowerCase() === '.svg') {
    throw new Error('SVG_NEEDS_WINDOW');
  }
  if (image.isEmpty()) throw new Error('Não consegui ler essa imagem.');
  const size = image.getSize();
  const buffer = image.toPNG();
  fs.writeFileSync(pngDest, buffer);
  return { width: size.width || 1, height: size.height || 1, buffer };
}

async function imageToPdf(imagePath, dest) {
  const { PDFDocument } = require('pdf-lib');
  const { nativeImage } = require('electron');
  let bytes;
  let kind = 'png';
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    bytes = fs.readFileSync(imagePath);
    kind = 'jpg';
  } else if (ext === '.png') {
    bytes = fs.readFileSync(imagePath);
  } else {
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) throw new Error('Não consegui ler essa imagem.');
    bytes = image.toPNG();
  }
  const doc = await PDFDocument.create();
  const embedded = kind === 'jpg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
  let width = embedded.width;
  let height = embedded.height;
  const max = 1440;
  if (width > max || height > max) {
    const scale = max / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const page = doc.addPage([width, height]);
  page.drawImage(embedded, { x: 0, y: 0, width, height });
  fs.writeFileSync(dest, await doc.save());
}

async function textToPdf(text, dest) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;
  const margin = 56;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.45;
  const lines = wrapText(sanitizePdf(text || ' '), font, fontSize, maxWidth);
  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(line || ' ', {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.12, 0.12, 0.12),
    });
    y -= lineHeight;
  }
  fs.writeFileSync(dest, await doc.save());
}

function sanitizePdf(text) {
  return String(text)
    .replace(/\u0000/g, '')
    .replace(/[^\x09\x0a\x0d\x20-\xff]/g, '?')
    .replace(/\t/g, '    ');
}

function wrapText(text, font, size, maxWidth) {
  const lines = [];
  const paragraphs = String(text).split(/\r?\n/);
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const piece = line ? `${line} ${word}` : word;
      let width = maxWidth + 1;
      try {
        width = font.widthOfTextAtSize(piece, size);
      } catch {
        width = piece.length * size * 0.5;
      }
      if (width <= maxWidth) line = piece;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 2500);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHtml(title, inner) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Calibri,Segoe UI,sans-serif;margin:40px;line-height:1.55;color:#222}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style></head><body>${inner}</body></html>`;
}

function textToHtml(title, text) {
  const paragraphs = String(text)
    .split(/\r?\n\s*\r?\n/)
    .map((part) => `<p>${escapeHtml(part).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
  return wrapHtml(title, paragraphs || '<p></p>');
}

function textToRtf(text) {
  let body = '';
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '{' || ch === '}') body += `\\${ch}`;
    else if (ch === '\n') body += '\\par\n';
    else if (ch === '\r') continue;
    else if (code > 127 && code <= 32767) body += `\\u${code}?`;
    else if (code > 32767) body += `\\u${code - 65536}?`;
    else body += ch;
  }
  return `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs24 ${body}}`;
}

async function loadDocx() {
  try {
    return require('docx');
  } catch {
    return import('docx');
  }
}

async function textToDocx(text, dest) {
  const { Document, Packer, Paragraph, TextRun } = await loadDocx();
  const children = String(text)
    .split(/\r?\n/)
    .slice(0, 2000)
    .map((line) => new Paragraph({ children: [new TextRun(line || ' ')] }));
  const doc = new Document({ sections: [{ children: children.length ? children : [new Paragraph(' ')] }] });
  fs.writeFileSync(dest, await Packer.toBuffer(doc));
}

async function imageToDocx(pngPath, width, height, dest) {
  const { Document, Packer, Paragraph, ImageRun } = await loadDocx();
  const maxW = 600;
  const scale = width > maxW ? maxW / width : 1;
  const data = fs.readFileSync(pngPath);
  const image = new ImageRun({
    type: 'png',
    data,
    transformation: {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    },
  });
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [image] })] }],
  });
  fs.writeFileSync(dest, await Packer.toBuffer(doc));
}

function pngToSvg(buffer, width, height) {
  const b64 = Buffer.from(buffer).toString('base64');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <image href="data:image/png;base64,${b64}" width="${width}" height="${height}"/>\n</svg>\n`;
}

module.exports = {
  FORMATS,
  createConverter,
  textToPdf,
  textToDocx,
  imageToPdf,
};
