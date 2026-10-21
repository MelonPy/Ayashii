// Vérifie les menus de restaurants/*.json (structure, références, émojis).
//
//   node tools/check-restaurants.mjs
//
// Les émojis doivent figurer dans SAFE_EMOJI : uniquement des émojis publiés
// jusqu'à Emoji 11.0 (2018), affichés par Android 9+, iOS 12+ et Windows 10+.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../restaurants/', import.meta.url));

const SAFE_EMOJI = new Set([...[
  // Emoji 0.6 – 1.0 (Unicode 6–8)
  '🍇🍈🍉🍊🍋🍌🍍🍎🍏🍐🍑🍒🍓🍅🍆🌽🍄🌰🍞🍖🍗🍔🍟🍕🌭🌮🌯🍿🍳🍲🍱🍘🍙🍚🍛🍜🍝🍠',
  '🍢🍣🍤🍥🍡🍦🍧🍨🍩🍪🎂🍰🍫🍬🍭🍮🍯🍼☕🍵🍶🍷🍸🍹🍺🍻🍾🍴🧀🐟🐠🐡🐙🐚🦀🐔🐄🐖🦃',
  '🌿🌱🌾🍀🍁🔥💧🌙⭐✨🎉🥢🍽🌶❄',
  // Emoji 3.0 (2016)
  '🥐🥑🥒🥓🥔🥕🥖🥗🥘🥙🥚🥛🥜🥝🥞🦐🦑🥂🥃🥄🦆',
  // Emoji 5.0 (2017)
  '🥟🥠🥡🥣🥤🥥🥦🥧🥨🥩🥪🥫',
  // Emoji 11.0 (2018)
  '🥬🥭🥮🥯🧁🧂🦞',
  // Interface (onglets, infos pratiques)
  '📍📞🌐🕒👑🖨📋👥',
].join('')]);

const emojiParts = icon => String(icon).match(/\p{Extended_Pictographic}️?/gu) || [];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

let errors = 0;
const fail = (file, msg) => {
  errors++;
  console.error(`✗ ${file} : ${msg}`);
};

function checkIcon(file, where, icon) {
  if (icon == null) return;
  const parts = emojiParts(icon);
  if (!parts.length || parts.join('') !== icon) return fail(file, `${where} : « ${icon} » n'est pas un émoji simple`);
  if (parts.length > 2) fail(file, `${where} : 2 émojis maximum (plat + ingrédient)`);
  for (const p of parts) {
    if (!SAFE_EMOJI.has(p.replace(/️/g, ''))) fail(file, `${where} : « ${p} » trop récent ou non prévu (voir SAFE_EMOJI)`);
  }
}

async function checkRestaurant(entry) {
  const file = entry.file;
  let r;
  try {
    r = JSON.parse(await readFile(new URL(file, `file://${dir}`), 'utf8'));
  } catch (err) {
    return fail(file, `illisible (${err.message})`);
  }
  if (r.id !== entry.id) fail(file, `id « ${r.id} » différent de celui de index.json (« ${entry.id} »)`);
  if (!/^[a-z0-9-]+$/.test(r.id || '')) fail(file, 'id invalide (minuscules, chiffres, tirets)');
  for (const key of ['name', 'categories', 'items']) if (!r[key]) fail(file, `champ « ${key} » manquant`);
  if (!r.categories || !r.items) return;

  const periods = new Set((r.periods || []).map(p => p.id));
  const guests = (r.guests || [{ id: 'adulte' }]).map(g => g.id);
  for (const p of r.periods || []) {
    for (const g of guests) if (typeof p.prices?.[g] !== 'number') fail(file, `formule ${p.id} : prix manquant pour « ${g} »`);
    if (p.schedule && !(HHMM.test(p.schedule.from) && HHMM.test(p.schedule.to))) fail(file, `formule ${p.id} : horaires invalides`);
  }

  const cats = new Set();
  for (const c of r.categories) {
    if (cats.has(c.id)) fail(file, `catégorie en double : ${c.id}`);
    cats.add(c.id);
    checkIcon(file, `catégorie ${c.id}`, c.icon);
    for (const p of c.periods || []) if (!periods.has(p)) fail(file, `catégorie ${c.id} : formule inconnue « ${p} »`);
  }

  const ids = new Set();
  for (const item of r.items) {
    const id = item.id || item.n;
    if (!id) {
      fail(file, `plat sans numéro ni id : ${item.name}`);
      continue;
    }
    if (ids.has(id)) fail(file, `plat en double : ${id}`);
    ids.add(id);
    if (!cats.has(item.cat)) fail(file, `plat ${id} : catégorie inconnue « ${item.cat} »`);
    if (!item.name) fail(file, `plat ${id} : nom manquant`);
    checkIcon(file, `plat ${id}`, item.icon);
    for (const p of item.periods || []) if (!periods.has(p)) fail(file, `plat ${id} : formule inconnue « ${p} »`);
  }

  for (const id of r.favorites || []) if (!ids.has(id)) fail(file, `favoris : plat inconnu « ${id} »`);

  const info = r.info || {};
  for (const h of info.hours || []) {
    if (!Array.isArray(h.days) || h.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) fail(file, 'horaires : jours invalides (0 = dimanche … 6 = samedi)');
    for (const slot of h.slots || []) {
      if (!Array.isArray(slot) || slot.length !== 2 || !slot.every(t => HHMM.test(t))) fail(file, `horaires : créneau invalide ${JSON.stringify(slot)}`);
    }
  }
  if (info.website) {
    try {
      new URL(info.website);
    } catch {
      fail(file, `site web invalide : ${info.website}`);
    }
  }

  console.log(`✓ ${file} : ${r.items.length} plats, ${r.categories.length} catégories`);
}

const index = JSON.parse(await readFile(new URL('index.json', `file://${dir}`), 'utf8'));
for (const entry of index) await checkRestaurant(entry);
if (errors) {
  console.error(`\n${errors} erreur${errors > 1 ? 's' : ''}.`);
  process.exit(1);
}
