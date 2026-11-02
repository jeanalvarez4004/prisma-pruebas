'use strict';

/**
 * Extracción de texto de documentos subidos por el Admin (Markdown, texto y PDF de hasta 10 MB).
 * El PDF se lee sin dependencias externas: sirve para PDFs con texto (Word, Google Docs, LaTeX);
 * los PDFs escaneados (solo imagen) no contienen texto y se rechazan con un mensaje claro.
 */
const zlib = require('node:zlib');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['md', 'markdown', 'txt', 'pdf']);

function extension(filename) {
  const match = String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function unescapePdfString(raw) {
  return raw
    .replace(/\\([nrtbf])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '' }[c]))
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\\r?\n/g, '');
}

function decodeHexString(hex) {
  const clean = hex.replace(/\s+/g, '');
  if (!clean || clean.length % 2) return '';
  const bytes = Buffer.from(clean, 'hex');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return bytes.subarray(2).swap16().toString('utf16le');
  // Fuentes con CID de 2 bytes: se intenta tratar cada par como carácter; si no, Latin-1.
  return bytes.toString('latin1');
}

function textFromContentStream(content) {
  const out = [];
  const blocks = content.match(/BT[\s\S]*?ET/g) || [];
  for (const block of blocks) {
    const tokenRe = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|\bT\*|\bTd\b|\bTD\b|\bET\b/g;
    let match;
    while ((match = tokenRe.exec(block)) !== null) {
      if (match[1] !== undefined) {
        const parts = [];
        const partRe = /\(((?:\\.|[^\\)])*)\)|(-?\d+(?:\.\d+)?)|<([0-9A-Fa-f\s]+)>/g;
        let part;
        while ((part = partRe.exec(match[1])) !== null) {
          if (part[1] !== undefined) parts.push(unescapePdfString(part[1]));
          else if (part[3] !== undefined) parts.push(decodeHexString(part[3]));
          else if (Number(part[2]) < -250) parts.push(' ');
        }
        out.push(parts.join(''));
      } else if (match[2] !== undefined) {
        out.push(unescapePdfString(match[2]));
      } else if (match[3] !== undefined) {
        out.push(decodeHexString(match[3]));
      } else {
        out.push('\n');
      }
    }
    out.push('\n');
  }
  return out.join('');
}

function ascii85Decode(input) {
  const text = input.toString('latin1').replace(/\s+/g, '').replace(/^<~/, '');
  const end = text.indexOf('~>');
  const body = end === -1 ? text : text.slice(0, end);
  const out = [];
  let group = [];
  for (const ch of body) {
    if (ch === 'z' && !group.length) { out.push(0, 0, 0, 0); continue; }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      let value = 0;
      for (const d of group) value = value * 85 + d;
      out.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let value = 0;
    for (const d of group) value = value * 85 + d;
    const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    out.push(...bytes.slice(0, n - 1));
  }
  return Buffer.from(out);
}

function applyFilters(data, dict) {
  const spec = dict.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/);
  const filters = spec ? (spec[1].match(/\/[A-Za-z0-9]+/g) || []).map((f) => f.slice(1)) : [];
  let result = data;
  for (const filter of filters) {
    if (filter === 'ASCII85Decode' || filter === 'A85') result = ascii85Decode(result);
    else if (filter === 'FlateDecode' || filter === 'Fl') {
      try { result = zlib.inflateSync(result); } catch { result = zlib.inflateSync(result.subarray(0, result.length - 1)); }
    } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      result = Buffer.from(result.toString('latin1').replace(/[^0-9A-Fa-f]/g, ''), 'hex');
    } else throw new Error(`Filtro no soportado: ${filter}`);
  }
  return result;
}

function extractPdfText(buffer) {
  const binary = buffer.toString('latin1');
  const pieces = [];
  const streamRe = /<<([\s\S]*?)>>\s*stream\r?\n/g;
  let match;
  while ((match = streamRe.exec(binary)) !== null) {
    const start = streamRe.lastIndex;
    const end = binary.indexOf('endstream', start);
    if (end === -1) break;
    const dict = match[1];
    if (/\/Subtype\s*\/(Image|Form)|\/Type\s*\/(XRef|ObjStm)/.test(dict)) continue;
    let data = buffer.subarray(start, end);
    try {
      data = applyFilters(data, dict);
    } catch {
      continue; // filtro no soportado (p. ej. LZW o cifrado): se ignora ese objeto
    }
    const text = textFromContentStream(data.toString('latin1'));
    if (text.trim()) pieces.push(text);
  }
  return pieces.join('\n');
}

function cleanExtracted(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractText(filename, buffer) {
  const ext = extension(filename);
  if (!ALLOWED.has(ext)) throw Object.assign(new Error('Formato no admitido. Sube un archivo .md, .txt o .pdf.'), { status: 400 });
  if (!buffer.length) throw Object.assign(new Error('El archivo está vacío.'), { status: 400 });
  if (buffer.length > MAX_BYTES) throw Object.assign(new Error('El archivo supera el límite de 10 MB.'), { status: 413 });

  let text;
  if (ext === 'pdf') {
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('El archivo no es un PDF válido.'), { status: 400 });
    text = cleanExtracted(extractPdfText(buffer));
    if (text.length < 20) {
      throw Object.assign(new Error('No se pudo extraer texto del PDF (puede ser un escaneo o usar fuentes especiales). Sube una versión en .md o .txt.'), { status: 422 });
    }
  } else {
    text = cleanExtracted(buffer.toString('utf8'));
    if (!text) throw Object.assign(new Error('El documento no contiene texto.'), { status: 422 });
  }
  return text;
}

/**
 * Divide el texto en fragmentos de ~size caracteres. Cada sección (encabezado Markdown) se
 * indexa por separado para que un tema no se diluya dentro de un documento corto; los
 * párrafos se agrupan respetando el tamaño y con solapamiento.
 */
function chunkText(text, size = 900, overlap = 120) {
  const sections = text.split(/\n(?=#{1,6}\s)/).map((section) => section.trim()).filter(Boolean);
  const chunks = [];
  for (const section of sections) {
    const paragraphs = section.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let current = '';
    const flush = () => {
      if (current.trim()) chunks.push(current.trim());
      current = '';
    };
    for (const paragraph of paragraphs) {
      if (paragraph.length > size) {
        flush();
        for (let i = 0; i < paragraph.length; i += size - overlap) chunks.push(paragraph.slice(i, i + size).trim());
        continue;
      }
      if (current && current.length + paragraph.length + 2 > size) {
        const tail = current.slice(-overlap);
        flush();
        current = tail;
      }
      current += (current ? '\n\n' : '') + paragraph;
    }
    flush();
  }
  return chunks.filter((c) => c.length > 15);
}

module.exports = { extractText, chunkText, extension, MAX_BYTES };
