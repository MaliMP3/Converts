function geom(item) {
  const t = item.transform || [1, 0, 0, 1, 0, 0];
  const fontSize = Math.hypot(t[0], t[1]) || Math.abs(t[3]) || 10;
  return {
    str: item.str == null ? '' : String(item.str),
    x: t[4],
    y: t[5],
    fontSize,
    width: Number(item.width) || 0,
    hasEOL: !!item.hasEOL,
  };
}

function clusterRows(rawItems) {
  const items = rawItems.map(geom).filter((item) => item.str !== '');
  if (!items.length) return [];

  const sorted = items.slice().sort((a, b) => {
    if (Math.abs(b.y - a.y) > 0.01) return b.y - a.y;
    return a.x - b.x;
  });

  const rows = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    const tol = Math.max(2.2, Math.min(item.fontSize, last ? last.fontSize : item.fontSize) * 0.35);
    if (last && Math.abs(last.y - item.y) <= tol) {
      last.items.push(item);
      last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length;
      last.fontSize = Math.max(last.fontSize, item.fontSize);
    } else {
      rows.push({
        y: item.y,
        fontSize: item.fontSize,
        items: [item],
      });
    }
  }

  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.segments = joinRow(row.items);
    row.text = row.segments.map((part) => part.text).join('').replace(/[ \t]+$/g, '');
    row.maxFont = row.items.reduce((max, item) => Math.max(max, item.fontSize), 0);
    row.minX = row.items[0].x;
  }
  return rows;
}

function joinRow(items) {
  const parts = [];
  let text = '';
  let fontSize = items[0].fontSize;
  let startX = items[0].x;

  function flush() {
    if (!text) return;
    parts.push({ text, fontSize, x: startX });
    text = '';
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!text) {
      text = item.str;
      fontSize = item.fontSize;
      startX = item.x;
      continue;
    }

    const prev = items[index - 1];
    const gap = item.x - (prev.x + prev.width);
    const base = Math.max(prev.fontSize, item.fontSize, 1);
    const endsSpace = /\s$/.test(text);
    const startsSpace = /^\s/.test(item.str);

    if (gap <= base * 0.38 || (gap < base * 0.8 && !endsSpace && !startsSpace && looksSmallCapsJoin(prev, item))) {
      text += item.str;
      fontSize = Math.max(fontSize, item.fontSize);
      continue;
    }

    if (gap >= Math.max(36, base * 3.2)) {
      flush();
      parts.push({ text: '\t', fontSize: base, x: prev.x + prev.width, gap: true });
      text = item.str;
      fontSize = item.fontSize;
      startX = item.x;
      continue;
    }

    if (!endsSpace && !startsSpace) text += ' ';
    text += item.str;
    fontSize = Math.max(fontSize, item.fontSize);
  }
  flush();
  return parts;
}

function looksSmallCapsJoin(prev, item) {
  if (!prev.str || !item.str) return false;
  if (/\s$/.test(prev.str) || /^\s/.test(item.str)) return false;
  const ratio = Math.min(prev.fontSize, item.fontSize) / Math.max(prev.fontSize, item.fontSize);
  if (ratio > 0.85) return false;
  return /^[A-Za-zÀ-ÿ]$/.test(prev.str) || /^[A-Za-zÀ-ÿ]{2,}$/.test(item.str);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function withBreaks(rows) {
  if (!rows.length) return [];
  const gaps = [];
  for (let index = 1; index < rows.length; index += 1) {
    gaps.push(rows[index - 1].y - rows[index].y);
  }
  const lead = median(gaps.filter((gap) => gap > 0)) || 14;
  const soft = lead * 1.55;
  const hard = lead * 2.15;

  const out = [];
  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) {
      const gap = rows[index - 1].y - rows[index].y;
      if (gap >= hard) out.push({ blank: 2, y: rows[index].y + gap / 2 });
      else if (gap >= soft) out.push({ blank: 1, y: rows[index].y + gap / 2 });
    }
    out.push(rows[index]);
  }
  return out;
}

function pageToText(items) {
  const rows = withBreaks(clusterRows(items));
  const lines = [];
  let inBullet = false;
  for (const row of rows) {
    if (row.blank) {
      for (let n = 0; n < row.blank; n += 1) lines.push('');
      inBullet = false;
      continue;
    }
    let line = row.segments.map((part) => part.text).join('').replace(/[ \t]+$/g, '');
    const bullet = isBulletText(line);
    if (bullet) {
      inBullet = true;
    } else if (inBullet && row.minX >= 70) {
      line = `  ${line.trim()}`;
    } else {
      inBullet = false;
    }
    lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isBulletText(text) {
  return /^[●▪◦]\s*/.test(String(text || '').trim());
}

function stripBullet(text) {
  return String(text || '').replace(/^[●▪◦]\s*/, '');
}

function classifyRow(row, pageMaxFont, options = {}) {
  const text = (row.text || '').trim();
  if (!text) return 'empty';
  const first = row.segments && row.segments[0] ? String(row.segments[0].text || '').trim() : '';
  if (isBulletText(text) || isBulletText(first)) return 'bullet';
  if (
    options.allowTitle !== false &&
    row.maxFont >= pageMaxFont - 0.4 &&
    row.maxFont >= 13 &&
    (options.titleCount || 0) < 2
  ) {
    return 'title';
  }
  if (row.maxFont >= Math.min(pageMaxFont * 0.72, 11.2) && row.maxFont >= 10.5 && text.length < 80) {
    const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
    const upper = (text.match(/[A-ZÀ-Ü]/g) || []).length;
    if (letters && upper / letters.length >= 0.72) return 'section';
  }
  if (row.segments.some((part) => part.gap)) return 'split';
  return 'body';
}

function rowHtml(row, pageMaxFont, kind) {
  const text = (row.text || '').trim();
  if (!text) return '';
  const resolved = kind || classifyRow(row, pageMaxFont);

  if (resolved === 'title') {
    return `<h1 style="font-size:${Math.round(row.maxFont * 1.35)}px;margin:0 0 0.2em;text-align:center">${escapeHtml(text)}</h1>`;
  }
  if (resolved === 'subtitle') {
    return `<p class="subtitle" style="font-size:${Math.round(row.maxFont * 1.25)}px;margin:0 0 0.55em;text-align:center;font-weight:600">${escapeHtml(text)}</p>`;
  }
  if (resolved === 'section') {
    return `<h2 style="font-size:${Math.round(Math.max(row.maxFont, 12) * 1.2)}px;margin:1.35em 0 0.45em;letter-spacing:0.04em">${escapeHtml(text)}</h2>`;
  }
  if (resolved === 'bullet') {
    return `<li style="font-size:${Math.round(row.maxFont * 1.15)}px;margin:0.25em 0">${escapeHtml(stripBullet(text))}</li>`;
  }
  if (resolved === 'split') {
    const left = [];
    const right = [];
    let side = left;
    for (const part of row.segments) {
      if (part.gap) {
        side = right;
        continue;
      }
      side.push(part.text);
    }
    const leftText = left.join('').trim();
    const rightText = right.join('').trim();
    return `<div class="row-split" style="font-size:${Math.round(row.maxFont * 1.15)}px;display:flex;justify-content:space-between;gap:1.5rem;margin:0.2em 0"><span>${escapeHtml(leftText)}</span><span style="text-align:right;white-space:nowrap">${escapeHtml(rightText)}</span></div>`;
  }

  const centered = row.minX > 110;
  const style = `font-size:${Math.round(row.maxFont * 1.15)}px;margin:0.2em 0${centered ? ';text-align:center' : ''}`;
  return `<p style="${style}">${escapeHtml(text)}</p>`;
}

function pageToHtml(items) {
  const clustered = clusterRows(items);
  if (!clustered.length) return '';
  const pageMaxFont = clustered.reduce((max, row) => Math.max(max, row.maxFont), 0);
  const rows = withBreaks(clustered);
  const chunks = [];
  let listOpen = false;
  let titleCount = 0;

  function closeList() {
    if (listOpen) {
      chunks.push('</ul>');
      listOpen = false;
    }
  }

  for (const row of rows) {
    if (row.blank) {
      closeList();
      continue;
    }

    let kind = classifyRow(row, pageMaxFont, { titleCount });
    if (kind === 'title') {
      titleCount += 1;
      if (titleCount > 1) kind = 'subtitle';
    }

    if (kind === 'bullet') {
      if (!listOpen) {
        chunks.push('<ul style="margin:0.25em 0 0.85em;padding-left:1.35em">');
        listOpen = true;
      }
      chunks.push(rowHtml(row, pageMaxFont, 'bullet'));
      continue;
    }

    if (listOpen && kind === 'body' && row.minX >= 70) {
      const last = chunks[chunks.length - 1];
      if (last && last.startsWith('<li')) {
        chunks[chunks.length - 1] = last.replace(
          /<\/li>$/,
          ` ${escapeHtml((row.text || '').trim())}</li>`
        );
        continue;
      }
    }

    closeList();
    const html = rowHtml(row, pageMaxFont, kind);
    if (html) chunks.push(html);
  }
  closeList();
  return chunks.join('\n');
}

function wrapLayoutHtml(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font-family:Calibri,Segoe UI,Arial,sans-serif;margin:48px auto;max-width:820px;line-height:1.45;color:#222;background:#fff}
h1{font-weight:700;line-height:1.2}
h2{font-weight:700;border-bottom:1px solid #ddd;padding-bottom:0.2em}
ul{list-style:disc}
.row-split{align-items:baseline}
p{white-space:pre-wrap}
@media print{body{margin:24px}}
</style></head><body>
${body}
</body></html>`;
}

function buildPdfLayout(pages, title) {
  const texts = [];
  const htmlParts = [];
  pages.forEach((pageItems, index) => {
    const text = pageToText(pageItems);
    if (text) texts.push(text);
    const html = pageToHtml(pageItems);
    if (html) {
      if (index > 0) htmlParts.push('<hr style="border:none;border-top:1px solid #ddd;margin:2.5em 0">');
      htmlParts.push(html);
    }
  });
  return {
    text: texts.join('\n\n').trim(),
    html: wrapLayoutHtml(title || 'Documento', htmlParts.join('\n') || '<p></p>'),
  };
}

module.exports = {
  clusterRows,
  pageToText,
  pageToHtml,
  buildPdfLayout,
  wrapLayoutHtml,
};
