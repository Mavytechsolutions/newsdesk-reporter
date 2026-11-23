// Members list as Excel (.xlsx) or PDF, with no outside packages.
const zlib = require('zlib');

/* ---------- Excel ---------- */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function zip(files) { // files: [[name, Buffer]], deflated
  const parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const nm = Buffer.from(name), comp = zlib.deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, nm, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28);
    c.writeUInt32LE(off, 42); central.push(c, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const x = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
function colName(i) { let s = ''; i++; while (i) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }
function xlsx(title, head, rows, widths) {
  const all = [[title], [], head, ...rows];
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
    widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>' +
    all.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
      const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : ri === 2 ? ' s="2"' : '';
      return typeof v === 'number' ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
    }).join('') + '</row>').join('') +
    `</sheetData><autoFilter ref="A3:${colName(head.length - 1)}${all.length}"/></worksheet>`;
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Members" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Members!$A$3:$' + colName(head.length - 1) + '$' + all.length + '</definedName></definedNames></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFD6001C"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD6001C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf fontId="2" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheet],
  ].map(([n, s]) => [n, Buffer.from(s, 'utf8')]);
  return zip(files);
}

/* ---------- PDF (A4 landscape, Helvetica) ---------- */
const W = { ' ': 278, '.': 278, ',': 278, '-': 333, '/': 278, '(': 333, ')': 333, ':': 278, '·': 278, I: 278, i: 222, l: 222, j: 222, f: 278, t: 278, r: 333, m: 833, w: 722, M: 833, W: 944 };
const cw = (ch, bold) => (W[ch] ?? (/[A-Z0-9]/.test(ch) ? 667 : 556)) * (bold ? 1.05 : 1);
const tw = (s, size, bold) => [...s].reduce((a, c) => a + cw(c, bold), 0) * size / 1000;
const ascii = s => String(s ?? '').replace(/[·•]/g, '-').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '');
const pe = s => ascii(s).replace(/[\\()]/g, c => '\\' + c);
function fit(s, size, max, bold) { s = ascii(s); if (tw(s, size, bold) <= max) return s; while (s && tw(s + '...', size, bold) > max) s = s.slice(0, -1); return s + '...'; }
function pdf(title, sub, head, rows, widths) {
  const PW = 842, PH = 595, M = 30, size = 8.5, rowH = 15.5, top = PH - M;
  const pages = [], per = Math.floor((PH - 2 * M - 70) / rowH);
  const total = Math.max(1, Math.ceil(rows.length / per));
  for (let p = 0; p < total; p++) {
    const ops = []; let y = top;
    const T = (str, xx, yy, sz, bold, rgb) => ops.push(`BT ${rgb || '0.08 0.09 0.11'} rg /${bold ? 'F2' : 'F1'} ${sz} Tf ${xx.toFixed(1)} ${yy.toFixed(1)} Td (${pe(str)}) Tj ET`);
    ops.push('0.839 0 0.11 rg', `${M} ${y - 4} ${PW - 2 * M} 4 re f`);
    y -= 24; T(title, M, y, 15, true, '0.839 0 0.11');
    T(`Page ${p + 1} of ${total}`, PW - M - tw(`Page ${p + 1} of ${total}`, 9), y, 9, false, '0.4 0.4 0.4');
    y -= 15; T(sub, M, y, 9.5, false, '0.3 0.3 0.3');
    y -= 22; ops.push('0.839 0 0.11 rg', `${M} ${y - 5} ${PW - 2 * M} ${rowH} re f`);
    let xx = M + 4; head.forEach((h, i) => { T(fit(h, 8.5, widths[i] - 6, true), xx, y, 8.5, true, '1 1 1'); xx += widths[i]; });
    rows.slice(p * per, (p + 1) * per).forEach((r, ri) => {
      y -= rowH;
      if (ri % 2) ops.push('0.96 0.955 0.94 rg', `${M} ${y - 5} ${PW - 2 * M} ${rowH} re f`);
      let x2 = M + 4; r.forEach((c, i) => { T(fit(c, size, widths[i] - 6, i === 2), x2, y, size, i === 2); x2 += widths[i]; });
    });
    ops.push('0.8 0.8 0.8 RG 0.5 w', `${M} ${M - 4} m ${PW - M} ${M - 4} l S`);
    T('AP Broadcast Journalists Association (APBJA) - confidential member list', M, M - 16, 8, false, '0.45 0.45 0.45');
    pages.push(ops.join('\n'));
  }
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  pages.forEach(c => { const cs = zlib.deflateSync(Buffer.from(c, 'latin1'));
    objs.push(`<< /Length ${cs.length} /Filter /FlateDecode >>\nstream\n` + cs.toString('latin1') + '\nendstream');
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(objs.length); });
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
module.exports = { xlsx, pdf };
