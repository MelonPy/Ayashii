// Encodage ESC/POS des mini-documents (js/print.js) pour imprimantes
// thermiques de ticket : la grande majorité des modèles 58 et 80 mm (Epson,
// Xprinter, Munbyn, imprimantes Bluetooth « POS »…) comprennent ces commandes.

import { FORMATS, layout } from './print.js';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

// Page de code PC858 (PC850 + €), sélectionnée par ESC t 19 : couvre les
// accents français. Les caractères absents sont remplacés ou désaccentués.
const CP858 = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87, ê: 0x88, ë: 0x89, è: 0x8a,
  ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f, É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95,
  û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99, Ü: 0x9a, '£': 0x9c, '×': 0x9e, á: 0xa0, í: 0xa1, ó: 0xa2,
  ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, '«': 0xae, '»': 0xaf, Á: 0xb5, Â: 0xb6, À: 0xb7, Ê: 0xd2, Ë: 0xd3,
  È: 0xd4, '€': 0xd5, Í: 0xd6, Î: 0xd7, Ï: 0xd8, Ó: 0xe0, ß: 0xe1, Ô: 0xe2, Ú: 0xe9, Û: 0xea, Ù: 0xeb,
  '°': 0xf8, '·': 0xfa,
};

const REPLACE = {
  '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '−': '-', '…': '...',
  œ: 'oe', Œ: 'OE', '•': '*', ' ': ' ', ' ': ' ', '★': '*', '☆': '*',
};

// `charset` : 'cp858' (accents) ou 'ascii' (sans accents, pour les
// imprimantes qui n'ont pas la page PC858).
export function encodeText(text, charset = 'cp858') {
  const out = [];
  for (const ch of String(text)) {
    const c = REPLACE[ch] ?? ch;
    if (c.length > 1) {
      out.push(...encodeText(c, charset));
      continue;
    }
    const code = c.charCodeAt(0);
    if (code < 0x80) out.push(code);
    else if (charset === 'cp858' && CP858[c]) out.push(CP858[c]);
    else if (c === '€') out.push(...encodeText('EUR', charset));
    else {
      const plain = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out.push(plain && plain.charCodeAt(0) < 0x80 ? plain.charCodeAt(0) : 0x3f); // '?'
    }
  }
  return out;
}

function qrCommands(data) {
  const bytes = [...new TextEncoder().encode(data)];
  const len = bytes.length + 3;
  return [
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // modèle 2
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06, // taille d'un module
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31, // correction d'erreur M
    GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...bytes, // données
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30, // impression
  ];
}

export function toEscPos(doc, format = '80', { charset = 'cp858', cut = true } = {}) {
  const cols = FORMATS[format === 'a4' ? '80' : format]?.cols || 48;
  const out = [ESC, 0x40]; // initialisation
  if (charset === 'cp858') out.push(ESC, 0x74, 19);
  for (const row of layout(doc, cols, true)) {
    if (row.qr) {
      out.push(ESC, 0x61, 1, ...qrCommands(row.qr), LF, ESC, 0x61, 0);
      continue;
    }
    out.push(ESC, 0x45, row.bold ? 1 : 0); // gras
    out.push(GS, 0x21, (row.wide ? 0x10 : 0) | (row.tall ? 0x01 : 0)); // taille
    out.push(...encodeText(row.text.replace(/\s+$/, ''), charset), LF);
  }
  out.push(ESC, 0x45, 0, GS, 0x21, 0);
  out.push(ESC, 0x64, 4); // avance le papier jusqu'au massicot
  if (cut) out.push(GS, 0x56, 0x42, 0x00); // coupe partielle
  return new Uint8Array(out);
}
