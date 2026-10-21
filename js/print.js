// Mini-documents imprimables (ticket de caisse 58/80 mm ou feuille A4).
//
// Un document est une liste de blocs simples, rendue au choix :
//   - en HTML pour l'impression du navigateur (AirPrint, imprimante Wi-Fi,
//     imprimante thermique avec pilote…) ;
//   - en texte brut à largeur fixe, à partager vers une appli d'impression
//     thermique (ESC/POS, Bluetooth) ou à coller n'importe où.
//
// Blocs : { t: 'title', text } · { t: 'text', text, small?, center? }
//         { t: 'kv', k, v, bold? } · { t: 'line', n, qty, text, sub? }
//         { t: 'hr' } · { t: 'big', text } · { t: 'qr', data } · { t: 'gap' }

import { esc, load, save } from './util.js';

export const FORMATS = {
  '58': { label: 'Ticket 58 mm', width: '58mm', cols: 32 },
  '80': { label: 'Ticket 80 mm', width: '80mm', cols: 48 },
  a4: { label: 'Feuille A4', width: '190mm', cols: 64, page: 'A4' },
};
const FORMAT_KEY = 'ayashii.print.format';

export function preferredFormat() {
  const f = load(FORMAT_KEY, '80');
  return FORMATS[f] ? f : '80';
}

export function rememberFormat(f) {
  if (FORMATS[f]) save(FORMAT_KEY, f);
}

/* ---------- HTML ---------- */

function qrSvg(data) {
  if (typeof window.qrcode !== 'function') return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true, alt: 'QR code' });
}

function blockHtml(b) {
  switch (b.t) {
    case 'title': return `<h1>${esc(b.text)}</h1>`;
    case 'text': return `<p class="${b.small ? 'sm' : ''} ${b.center ? 'c' : ''}">${esc(b.text)}</p>`;
    case 'kv': return `<div class="kv ${b.bold ? 'b' : ''}"><span>${esc(b.k)}</span><span>${esc(b.v)}</span></div>`;
    case 'line': return `
      <div class="ln"><span class="n">${esc(b.n || '')}</span><span class="q">${esc(b.qty)}×</span>
        <span class="tx">${esc(b.text)}${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</span></div>`;
    case 'hr': return '<hr>';
    case 'big': return `<div class="big">${esc(b.text)}</div>`;
    case 'qr': return `<div class="pqr">${qrSvg(b.data)}</div>`;
    case 'gap': return '<div class="gap"></div>';
    default: return '';
  }
}

export function toHtml(doc) {
  return `<div class="paper-doc">${doc.map(blockHtml).join('')}</div>`;
}

/* ---------- Texte à largeur fixe ---------- */

function wrap(text, width) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    out.push(line);
  }
  return out;
}

const center = (text, cols) => wrap(text, cols).map(l => ' '.repeat(Math.max(0, Math.floor((cols - l.length) / 2))) + l);

export function toText(doc, format = '80') {
  const cols = FORMATS[format]?.cols || 48;
  const lines = [];
  for (const b of doc) {
    switch (b.t) {
      case 'title': lines.push(...center(b.text.toUpperCase(), cols)); break;
      case 'big': lines.push(...center(b.text, cols)); break;
      case 'text': lines.push(...(b.center ? center(b.text, cols) : wrap(b.text, cols))); break;
      case 'kv': {
        const v = String(b.v);
        const k = wrap(b.k, Math.max(8, cols - v.length - 1));
        const last = k.pop();
        lines.push(...k, last + ' '.repeat(Math.max(1, cols - last.length - v.length)) + v);
        break;
      }
      case 'line': {
        const head = `${String(b.n || '').padStart(3)} ${String(b.qty).padStart(2)}x `;
        const body = wrap(b.text + (b.sub ? ` (${b.sub})` : ''), cols - head.length);
        body.forEach((l, i) => lines.push((i ? ' '.repeat(head.length) : head) + l));
        break;
      }
      case 'hr': lines.push('-'.repeat(cols)); break;
      case 'gap': lines.push(''); break;
      case 'qr': break; // pas de QR code en texte brut
    }
  }
  // Espaces insécables (montants en euros) : mal gérées par certaines imprimantes.
  return lines.join('\n').replace(/[\u00a0\u202f]/g, ' ');
}

/* ---------- Impression ---------- */

// Le document est rendu dans un conteneur dédié ; une feuille de style
// d'impression masque tout le reste de la page le temps de l'impression.
export function printDoc(doc, format = preferredFormat()) {
  const f = FORMATS[format] || FORMATS['80'];
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.className = `paper paper-${format}`;
  root.innerHTML = toHtml(doc);
  document.body.append(root);

  // Pour un ticket, la hauteur de page suit le contenu (pas de papier gâché).
  root.style.display = 'block';
  const heightMm = Math.ceil(root.getBoundingClientRect().height * 25.4 / 96) + 8;
  root.style.display = '';
  const style = document.createElement('style');
  style.textContent = f.page
    ? `@page { size: ${f.page}; margin: 10mm; }`
    : `@page { size: ${f.width} ${heightMm}mm; margin: 0; }`;
  root.prepend(style);

  // Pas de nettoyage sur `afterprint` : sur mobile, l'événement peut arriver
  // avant que la page ait été capturée. Le conteneur (invisible à l'écran)
  // est simplement remplacé à l'impression suivante.
  window.print();
}
