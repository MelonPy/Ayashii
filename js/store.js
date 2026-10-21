// Modèle de données d'une table.
//
// L'état n'est jamais modifié directement : chaque téléphone publie des
// événements, et tout le monde recalcule le même état à partir de la liste
// complète, triée par horodatage. Types d'événements :
//   member   { name, kind }               arrivée / changement de profil
//   picks    { r, items, ready, name }    sélection d'une personne pour la tournée r
//   send     { r, per }                   tournée r recopiée sur l'ardoise
//   unsend   { r }                        annulation du dernier envoi
//   settings { period }                   midi / soir…

import { load, save } from './util.js';

export const PROTOCOL = 1;

const byTime = (a, b) => a.ts - b.ts || (a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0);

export function isValidEvent(e) {
  return e && e.v === PROTOCOL && typeof e.cid === 'string' && typeof e.m === 'string'
    && typeof e.t === 'string' && Number.isFinite(e.ts);
}

export class EventLog {
  constructor(storageKey) {
    this.key = storageKey;
    this.events = new Map();
    this.latestPicks = new Map();
    this.saveTimer = null;
    for (const e of load(storageKey, [])) this.add(e, false);
  }

  // Renvoie true si l'événement change quelque chose.
  add(e, persist = true) {
    if (!isValidEvent(e) || this.events.has(e.cid)) return false;
    if (e.t === 'picks') {
      // Seule la dernière sélection d'une personne pour une tournée compte.
      const k = `${e.m}|${e.r}`;
      const prev = this.latestPicks.get(k);
      if (prev && byTime(prev, e) > 0) return false;
      if (prev) this.events.delete(prev.cid);
      this.latestPicks.set(k, e);
    }
    this.events.set(e.cid, e);
    if (persist) this.persist();
    return true;
  }

  persist() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => save(this.key, [...this.events.values()]), 300);
  }

  get size() {
    return this.events.size;
  }
}

export function derive(events) {
  const sorted = [...events].sort(byTime);
  const members = new Map();
  const sent = new Map();
  const picks = new Map();
  let period = null;

  const touchMember = (e, patch) => {
    const prev = members.get(e.m);
    members.set(e.m, { id: e.m, kind: 'adulte', since: e.ts, ...prev, ...patch });
  };

  for (const e of sorted) {
    switch (e.t) {
      case 'member':
        touchMember(e, { name: e.name, kind: e.kind || 'adulte' });
        break;
      case 'picks':
        if (!members.has(e.m)) touchMember(e, { name: e.name || '?' });
        picks.set(`${e.m}|${e.r}`, e);
        break;
      case 'send':
        if (!sent.has(e.r)) sent.set(e.r, e);
        break;
      case 'unsend':
        sent.delete(e.r);
        break;
      case 'settings':
        if (e.period) period = e.period;
        break;
    }
  }

  let round = 1;
  while (sent.has(round)) round++;

  const current = new Map();
  for (const e of picks.values()) {
    if (e.r === round) current.set(e.m, { items: cleanItems(e.items), ready: !!e.ready });
  }

  return {
    members,
    round,
    current,
    history: [...sent.values()].sort((a, b) => a.r - b.r),
    period,
  };
}

export function cleanItems(items) {
  const out = {};
  for (const [id, q] of Object.entries(items || {})) {
    const n = Math.floor(Number(q));
    if (n > 0 && n < 100) out[id] = n;
  }
  return out;
}

// { membre: { plat: qté } } → Map(plat → { qty, by: [[membre, qté]] })
export function aggregate(perMember) {
  const out = new Map();
  for (const [m, items] of Object.entries(perMember)) {
    for (const [id, q] of Object.entries(cleanItems(items))) {
      const row = out.get(id) || { qty: 0, by: [] };
      row.qty += q;
      row.by.push([m, q]);
      out.set(id, row);
    }
  }
  return out;
}

export function currentPerMember(state) {
  const per = {};
  for (const [m, { items }] of state.current) {
    if (Object.keys(items).length) per[m] = items;
  }
  return per;
}
