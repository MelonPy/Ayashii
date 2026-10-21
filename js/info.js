// Informations pratiques d'un restaurant (bloc `info` du JSON) : adresse,
// téléphone, horaires, services et remarques. Tous les champs sont facultatifs.

import { esc } from './util.js';

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // affichage du lundi au dimanche

const toMin = hhmm => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

export const hourLabel = hhmm => {
  const [h, m] = String(hhmm).split(':');
  return `${Number(h)}h${m && m !== '00' ? m : ''}`;
};

const cap = text => text.charAt(0).toUpperCase() + text.slice(1);

function slotsOf(hours, day) {
  return hours.find(h => h.days?.includes(day))?.slots || [];
}

const slotsText = slots => (slots.length
  ? slots.map(([from, to]) => `${hourLabel(from)}–${hourLabel(to)}`).join(' · ')
  : 'Fermé');

// Regroupe les jours consécutifs aux horaires identiques : « Mardi – samedi ».
export function hoursRows(hours, today = new Date().getDay()) {
  const rows = [];
  for (const day of WEEK) {
    const text = slotsText(slotsOf(hours, day));
    const last = rows.at(-1);
    if (last && last.text === text) last.days.push(day);
    else rows.push({ days: [day], text });
  }
  return rows.map(({ days, text }) => ({
    label: cap(days.length > 1 ? `${DAY_NAMES[days[0]]} – ${DAY_NAMES[days.at(-1)]}` : DAY_NAMES[days[0]]),
    text,
    today: days.includes(today),
  }));
}

// « Ouvert jusqu'à 14h30 », « Fermé · ouvre à 18h30 », « Fermé aujourd'hui »…
export function openStatus(hours, date = new Date()) {
  if (!hours?.length) return null;
  const now = date.getHours() * 60 + date.getMinutes();
  const slots = slotsOf(hours, date.getDay());
  const current = slots.find(([from, to]) => now >= toMin(from) && now < toMin(to));
  if (current) return { open: true, text: `Ouvert jusqu'à ${hourLabel(current[1])}` };
  const next = slots.find(([from]) => toMin(from) > now);
  if (next) return { open: false, text: `Fermé · ouvre à ${hourLabel(next[0])}` };
  for (let i = 1; i <= 7; i++) {
    const day = (date.getDay() + i) % 7;
    const first = slotsOf(hours, day)[0];
    if (first) {
      const when = i === 1 ? 'demain' : DAY_NAMES[day];
      return { open: false, text: `Fermé · ouvre ${when} à ${hourLabel(first[0])}` };
    }
  }
  return { open: false, text: 'Fermé' };
}

export function hasInfo(r) {
  const i = r.info || {};
  return !!(i.address || i.phone || i.website || i.hours?.length || i.services?.length || i.notes?.length);
}

export function infoHtml(r) {
  const i = r.info || {};
  if (!hasInfo(r)) return '';
  const status = openStatus(i.hours);
  const maps = i.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name}, ${i.address}`)}` : '';
  const tel = i.phone ? `tel:${i.phone.replace(/[^+\d]/g, '')}` : '';
  let host = '';
  try {
    host = i.website ? new URL(i.website).host.replace(/^www\./, '') : '';
  } catch {}

  return `
    <section class="card info">
      <h2 class="card-title">Informations pratiques</h2>
      ${i.address ? `
        <a class="info-row" href="${esc(maps)}" target="_blank" rel="noopener">
          <span class="info-ico" aria-hidden="true">📍</span>
          <span class="list-main"><b>${esc(i.address)}</b><small>Itinéraire</small></span>
          <span class="chevron" aria-hidden="true">›</span>
        </a>` : ''}
      ${i.phone ? `
        <a class="info-row" href="${esc(tel)}">
          <span class="info-ico" aria-hidden="true">📞</span>
          <span class="list-main"><b>${esc(i.phone)}</b><small>Appeler le restaurant</small></span>
          <span class="chevron" aria-hidden="true">›</span>
        </a>` : ''}
      ${host ? `
        <a class="info-row" href="${esc(i.website)}" target="_blank" rel="noopener">
          <span class="info-ico" aria-hidden="true">🌐</span>
          <span class="list-main"><b>${esc(host)}</b><small>Site du restaurant</small></span>
          <span class="chevron" aria-hidden="true">›</span>
        </a>` : ''}
      ${i.hours?.length ? `
        <div class="info-block">
          <div class="info-head">
            <span class="info-ico" aria-hidden="true">🕒</span><b>Horaires</b>
            ${status ? `<span class="open-state ${status.open ? 'is-open' : ''}">${esc(status.text)}</span>` : ''}
          </div>
          <dl class="hours">
            ${hoursRows(i.hours).map(row => `
              <div class="${row.today ? 'is-today' : ''}"><dt>${esc(row.label)}</dt><dd>${esc(row.text)}</dd></div>`).join('')}
          </dl>
        </div>` : ''}
      ${i.services?.length ? `
        <div class="tags">${i.services.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>` : ''}
      ${i.notes?.length ? `
        <ul class="info-notes">${i.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${i.hours?.length ? '<p class="muted small">Horaires indicatifs, hors jours fériés et congés.</p>' : ''}
    </section>`;
}
