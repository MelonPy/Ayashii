import { listRestaurants, getRestaurant } from './restaurant.js';
import { TableSession, RELAY_URL } from './session.js';
import { aggregate, currentPerMember } from './store.js';
import { infoHtml } from './info.js';
import { FORMATS, preferredFormat, rememberFormat, printDoc, toHtml, toText } from './print.js';
import {
  load, save, uid, tableCode, normalizeCode, esc, euros, fold, initials, memberHue, timeLabel,
} from './util.js';

const app = document.getElementById('app');
const PROFILE_KEY = 'ayashii.profile';
const RECENT_KEY = 'ayashii.recent';
const RECENT_TTL = 24 * 3600 * 1000;

const profile = load(PROFILE_KEY, null) || { id: uid(), name: '', kind: 'adulte' };
save(PROFILE_KEY, profile);

let session = null;
let view = null;
let newTableCode = null;

/* ---------- Routage (hash, compatible GitHub Pages) ---------- */

window.addEventListener('hashchange', route);
route();

async function route() {
  const [kind, rid, sub, code] = location.hash.replace(/^#\/?/, '').split('/');
  if (kind === 'r' && rid && sub === 't' && code) return showTable(rid, code);
  stopSession();
  if (kind === 'r' && rid) return showRestaurant(rid);
  return showHome();
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function stopSession() {
  session?.stop();
  session = null;
  view = null;
}

/* ---------- Accueil ---------- */

async function showHome() {
  document.title = 'Ardoise — commander à plusieurs';
  const restaurants = (await listRestaurants()).filter(Boolean);
  const recent = recentTables();
  app.innerHTML = `
    ${topbar({ title: 'Ardoise', subtitle: 'Commander à plusieurs' })}
    <main class="page">
      <section class="hero">
        <h1>Une ardoise partagée pour toute la table.</h1>
        <p>Chacun choisit ses plats sur son téléphone, l'application additionne tout et vous donne la liste à recopier sur l'ardoise du restaurant.</p>
      </section>
      ${recent.length ? `
        <h2 class="section-title">Reprendre une table</h2>
        <div class="list">
          ${recent.map(t => `
            <a class="list-row" href="#/r/${esc(t.rid)}/t/${esc(t.code)}">
              <span class="list-main"><b>${esc(t.name)}</b><small>Table ${esc(t.code)} · ${timeLabel(t.ts)}</small></span>
              <span class="chevron" aria-hidden="true">›</span>
            </a>`).join('')}
        </div>` : ''}
      <h2 class="section-title">Restaurants</h2>
      <div class="cards">
        ${restaurants.map(r => `
          <a class="resto-card" href="#/r/${esc(r.id)}" style="--resto:${esc(r.accent || '')}">
            <span class="resto-mark" aria-hidden="true">${esc(initials(r.name))}</span>
            <span class="list-main"><b>${esc(r.name)}</b><small>${esc(r.subtitle || '')}</small></span>
            <span class="chevron" aria-hidden="true">›</span>
          </a>`).join('')}
      </div>
    </main>`;
}

function recentTables() {
  const now = Date.now();
  return load(RECENT_KEY, []).filter(t => now - t.ts < RECENT_TTL);
}

function rememberTable(restaurant, code) {
  const list = recentTables().filter(t => !(t.rid === restaurant.id && t.code === code));
  list.unshift({ rid: restaurant.id, name: restaurant.name, code, ts: Date.now() });
  save(RECENT_KEY, list.slice(0, 8));
}

/* ---------- Page restaurant : créer / rejoindre ---------- */

async function showRestaurant(rid) {
  const r = await getRestaurant(rid);
  if (!r) return showNotFound();
  document.title = `${r.name} — Ardoise`;
  const period = r.detectPeriod();
  app.innerHTML = `
    ${topbar({ title: r.name, subtitle: r.subtitle, back: '#/' })}
    <main class="page" style="--resto:${esc(r.accent || '')}">
      ${r.periods.length ? `
        <section class="card prices">
          <h2 class="card-title">Formule à volonté</h2>
          ${r.periods.map(p => `
            <div class="price-row ${p.id === period ? 'is-now' : ''}">
              <div><b>${esc(p.label)}</b>${p.id === period ? '<span class="pill">maintenant</span>' : ''}<small>${esc(p.hint || '')}</small></div>
              <div class="price-values">
                ${r.guests.map(g => `<span>${esc(g.label)}<b>${p.prices[g.id] ? euros(p.prices[g.id]) : 'Gratuit'}</b></span>`).join('')}
              </div>
            </div>`).join('')}
        </section>` : ''}
      <section class="card">
        <h2 class="card-title">Nouvelle table</h2>
        <p class="muted">Ouvrez une table, puis faites scanner le QR code (ou dictez le code) aux autres convives.
          Vous en serez l'hôte : c'est vous qui validerez l'envoi de chaque tournée.</p>
        <button class="btn btn-primary btn-block" data-action="create">Ouvrir une table</button>
      </section>
      <section class="card">
        <h2 class="card-title">Rejoindre une table</h2>
        <form class="join-form" data-form="join">
          <input class="input code-input" name="code" inputmode="text" autocomplete="off" autocapitalize="characters"
            maxlength="7" placeholder="CODE" aria-label="Code de la table" required>
          <button class="btn" type="submit">Rejoindre</button>
        </form>
      </section>
      ${r.rules.note ? `<p class="note">${esc(r.rules.note)}</p>` : ''}
      ${infoHtml(r)}
    </main>`;

  app.querySelector('[data-action="create"]').addEventListener('click', () => {
    newTableCode = tableCode();
    go(`#/r/${r.id}/t/${newTableCode}`);
  });
  app.querySelector('[data-form="join"]').addEventListener('submit', ev => {
    ev.preventDefault();
    const code = normalizeCode(new FormData(ev.target).get('code'));
    if (!code) return toast('Code invalide : 6 lettres ou chiffres.');
    go(`#/r/${r.id}/t/${code}`);
  });
}

function showNotFound() {
  app.innerHTML = `
    ${topbar({ title: 'Introuvable', back: '#/' })}
    <main class="page"><p class="empty">Ce restaurant n'existe pas (ou plus).</p></main>`;
}

/* ---------- Table ---------- */

async function showTable(rid, rawCode) {
  const r = await getRestaurant(rid);
  if (!r) return showNotFound();
  const code = normalizeCode(rawCode);
  if (!code) {
    toast('Code de table invalide.');
    return go(`#/r/${rid}`);
  }
  if (session && session.restaurant.id === rid && session.code === code) return;
  stopSession();

  if (!profile.name) {
    app.innerHTML = `${topbar({ title: r.name, subtitle: `Table ${code}`, back: `#/r/${rid}` })}<main class="page"></main>`;
    const ok = await editProfile(r, { first: true });
    if (!ok) return go(`#/r/${rid}`);
    if (location.hash !== `#/r/${rid}/t/${rawCode}`) return;
  }

  const isNew = newTableCode === code;
  newTableCode = null;
  session = new TableSession(r, code, profile);
  session.join({ isNew });
  session.start();
  rememberTable(r, code);
  document.title = `${r.name} · Table ${code}`;
  view = new TableView(session);
  view.mount();
}

class TableView {
  constructor(s) {
    this.s = s;
    this.r = s.restaurant;
    this.tab = sessionStorage.getItem('ayashii.tab') || 'menu';
    this.scroll = {};
    this.query = '';
    this.onlySelected = false;
    this.struck = new Set();
    this.favKey = `ayashii.favorites.${this.r.id}`;
    this.favs = new Set(load(this.favKey, []).filter(id => this.r.itemsById.has(id)));
    this.lastRound = s.state.round;
    this.lastSentCount = s.state.history.length;
    this.lastHost = s.state.host;
    this.wasRemoved = s.isRemoved;
    // Le rejeu de l'historique à l'arrivée ne doit pas déclencher de notifications.
    this.quietUntil = Date.now() + 3000;
  }

  mount() {
    const { r, s } = this;
    app.innerHTML = `
      ${topbar({ title: r.name, subtitle: `Table ${s.code}`, back: `#/r/${r.id}`, status: true })}
      <main class="table-page" style="--resto:${esc(r.accent || '')}">
        <div class="banner" data-ref="removed" hidden>
          <span>Vous avez été retiré·e de la table par l'hôte.</span>
          <button class="btn btn-small btn-primary" data-action="rejoin">Revenir</button>
        </div>
        <section class="pane" data-pane="menu">
          <div class="menu-tools">
            <div class="mybar">
              <div class="mycount" data-ref="mycount"></div>
              <button class="btn btn-small" data-action="ready"></button>
            </div>
            <input class="input search" type="search" data-ref="search" placeholder="Rechercher un plat ou un numéro" aria-label="Rechercher">
            <nav class="chips" data-ref="chips">
              <button class="chip" data-cat="favoris">★ Favoris</button>
              <button class="chip chip-selection" data-action="only-selected">✓ Sélection</button>
              ${r.categories.map(c => `<button class="chip" data-cat="${esc(c.id)}">${c.icon ? `${esc(c.icon)} ` : ''}${esc(c.short || c.name)}</button>`).join('')}
            </nav>
          </div>
          <div class="menu-list" data-ref="menu">${this.menuHtml()}</div>
          <p class="empty" data-ref="noresult" hidden>Aucun plat ne correspond.</p>
        </section>
        <section class="pane" data-pane="slate"></section>
        <section class="pane" data-pane="table">
          <div class="card share">
            <div class="share-code">
              <small>Code de la table</small>
              <b>${esc(s.code)}</b>
            </div>
            <div class="qr" data-ref="qr"></div>
            <div class="share-actions">
              <button class="btn" data-action="share">Partager le lien</button>
              <button class="btn" data-action="copy-link">Copier</button>
              <button class="btn" data-action="print" data-doc="invite" aria-label="Imprimer le QR code">🖨️</button>
            </div>
          </div>
          <div data-ref="table-dynamic"></div>
        </section>
      </main>
      <nav class="tabbar" role="tablist">
        <button data-tab="menu" role="tab"><span class="tab-ico" aria-hidden="true">🍣</span>Menu</button>
        <button data-tab="slate" role="tab"><span class="tab-ico" aria-hidden="true">📋</span>Ardoise<span class="badge" data-ref="badge" hidden></span></button>
        <button data-tab="table" role="tab"><span class="tab-ico" aria-hidden="true">👥</span>Table</button>
      </nav>`;

    this.ref = name => app.querySelector(`[data-ref="${name}"]`);
    this.renderQr();
    this.bind();
    s.on(() => this.update());
    this.switchTab(this.tab, false);
    this.update();
  }

  menuHtml() {
    const { r } = this;
    return `<section class="cat cat-favs" id="cat-favoris" data-ref="favs">${this.favsHtml()}</section>` + r.categories.map(c => {
      const items = r.items.filter(i => i.cat === c.id);
      if (!items.length) return '';
      return `
        <section class="cat" id="cat-${esc(c.id)}" data-cat-section="${esc(c.id)}">
          <h2 class="cat-title">${c.icon ? `<span aria-hidden="true">${esc(c.icon)}</span> ` : ''}${esc(c.name)}
            ${c.note ? `<small>${esc(c.note)}</small>` : ''}${c.extra ? '<small>Payant, hors formule</small>' : ''}</h2>
          ${items.map(i => this.itemHtml(i)).join('')}
        </section>`;
    }).join('');
  }

  // Les favoris du convive (enregistrés sur ce téléphone) ou, à défaut,
  // les suggestions du restaurant.
  favsHtml() {
    const { r } = this;
    const mine = r.items.filter(i => this.favs.has(i.id));
    const list = mine.length ? mine : r.favorites.map(id => r.itemsById.get(id));
    const hint = mine.length
      ? 'Enregistrés sur ce téléphone'
      : list.length
        ? 'Quelques idées pour commencer · touchez ☆ sur un plat pour créer vos favoris'
        : 'Touchez ☆ sur un plat pour le retrouver ici';
    return `
      <h2 class="cat-title"><span aria-hidden="true">★</span> Favoris <small>${esc(hint)}</small></h2>
      ${list.map(i => this.itemHtml(i)).join('')}`;
  }

  itemHtml(item) {
    const extra = this.r.isExtra(item);
    const meta = [item.desc, item.pcs].filter(Boolean).join(' · ');
    const price = item.price ? `<span class="price">${extra ? '' : '+'}${euros(item.price)}</span>` : '';
    const search = fold([item.n, item.name, item.desc, item.pcs].filter(Boolean).join(' '));
    const [main, ...more] = emojiParts(item.icon);
    return `
      <div class="item" data-item="${esc(item.id)}" data-search="${esc(search)}">
        <div class="vis ${item.n ? '' : 'vis-extra'}">
          ${main ? `<span class="vis-emo" aria-hidden="true">${esc(main)}${more.length ? `<span class="vis-sub">${esc(more.join(''))}</span>` : ''}</span>` : ''}
          ${item.n ? `<span class="vis-num">${esc(item.n)}</span>` : ''}
        </div>
        <div class="item-info">
          <div class="item-name">${esc(item.name)} ${price}<button class="fav" data-fav aria-pressed="false" aria-label="Favori : ${esc(item.name)}"></button></div>
          ${meta ? `<div class="item-meta">${esc(meta)}</div>` : ''}
          <div class="item-off">${esc(this.offLabel(item))}</div>
          <div class="who" data-who></div>
        </div>
        <div class="stepper">
          <button class="step" data-step="-1" aria-label="Retirer ${esc(item.name)}">−</button>
          <span class="qty" data-qty>0</span>
          <button class="step step-plus" data-step="1" aria-label="Ajouter ${esc(item.name)}">+</button>
        </div>
      </div>`;
  }

  offLabel(item) {
    const periods = this.r.periodsOf(item) || [];
    return `Uniquement : ${periods.map(id => this.r.periodById(id)?.label || id).join(', ')}`;
  }

  renderQr() {
    const box = this.ref('qr');
    if (typeof window.qrcode !== 'function') return box.remove();
    const qr = window.qrcode(0, 'M');
    qr.addData(tableUrl(this.s));
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code pour rejoindre la table' });
  }

  bind() {
    app.querySelector('.tabbar').addEventListener('click', ev => {
      const btn = ev.target.closest('[data-tab]');
      if (btn) this.switchTab(btn.dataset.tab);
    });

    this.ref('menu').addEventListener('click', ev => {
      const step = ev.target.closest('[data-step]');
      if (step) this.step(step.closest('[data-item]').dataset.item, Number(step.dataset.step));
      const fav = ev.target.closest('[data-fav]');
      if (fav) this.toggleFav(fav.closest('[data-item]').dataset.item);
    });

    this.ref('search').addEventListener('input', ev => {
      this.query = fold(ev.target.value.trim());
      this.applyFilter();
    });

    this.ref('chips').addEventListener('click', ev => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.action === 'only-selected') {
        this.onlySelected = !this.onlySelected;
        this.applyFilter();
        window.scrollTo({ top: 0 });
        return;
      }
      const section = document.getElementById(`cat-${chip.dataset.cat}`);
      if (section && !section.hidden) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    app.querySelector('.table-page').addEventListener('click', ev => {
      const el = ev.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;
      if (action === 'ready') this.s.setPicks(this.s.mine.items, !this.s.mine.ready);
      else if (action === 'send') this.confirmSend();
      else if (action === 'copy-slate') copyText(this.slateText(), 'Liste copiée');
      else if (action === 'share') shareTable(this.s);
      else if (action === 'copy-link') copyText(tableUrl(this.s), 'Lien copié');
      else if (action === 'period') this.s.setPeriod(el.dataset.period);
      else if (action === 'profile') editProfile(this.r).then(ok => ok && this.s.join());
      else if (action === 'unsend') this.s.unsendRound(Number(el.dataset.round));
      else if (action === 'leave') go(`#/r/${this.r.id}`);
      else if (action === 'go-menu') this.switchTab('menu');
      else if (action === 'print') this.openPrint(el.dataset.doc);
      else if (action === 'manage') this.manageMember(el.dataset.member);
      else if (action === 'claim') this.confirmClaim();
      else if (action === 'rejoin') this.s.join({ force: true });
    });

    app.querySelector('[data-pane="slate"]').addEventListener('click', ev => {
      const row = ev.target.closest('[data-strike]');
      if (!row) return;
      const id = row.dataset.strike;
      if (this.struck.has(id)) this.struck.delete(id);
      else this.struck.add(id);
      row.classList.toggle('is-struck');
    });

    const tools = app.querySelector('.menu-tools');
    const setSticky = () => document.documentElement.style.setProperty('--tools-h', `${tools.offsetHeight}px`);
    new ResizeObserver(setSticky).observe(tools);
  }

  switchTab(tab, keepScroll = true) {
    if (keepScroll) this.scroll[this.tab] = window.scrollY;
    this.tab = tab;
    sessionStorage.setItem('ayashii.tab', tab);
    for (const pane of app.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== tab;
    for (const btn of app.querySelectorAll('[data-tab]')) btn.setAttribute('aria-selected', btn.dataset.tab === tab);
    window.scrollTo({ top: this.scroll[tab] || 0 });
  }

  toggleFav(id) {
    const item = this.r.itemsById.get(id);
    if (!item) return;
    const on = !this.favs.has(id);
    if (on) this.favs.add(id);
    else this.favs.delete(id);
    save(this.favKey, [...this.favs]);
    this.ref('favs').innerHTML = this.favsHtml();
    this.updateMenu();
    this.applyFilter();
    toast(on ? `★ ${item.name} ajouté aux favoris` : `${item.name} retiré des favoris`);
  }

  step(id, delta) {
    const { r, s } = this;
    const item = r.itemsById.get(id);
    if (!item) return;
    if (s.isRemoved) return toast('Revenez à la table pour commander (bandeau en haut).');
    const items = { ...s.mine.items };
    const next = (items[id] || 0) + delta;
    if (next < 0) return;
    if (delta > 0) {
      if (!r.isAvailable(item, s.period)) return toast(this.offLabel(item));
      if (r.limit && !r.isExtra(item) && r.countPortions(items) >= r.limit) {
        navigator.vibrate?.([30, 40, 30]);
        return toast(`Maximum ${r.limit} portions par personne et par tournée.`);
      }
      navigator.vibrate?.(8);
    }
    if (next) items[id] = next;
    else delete items[id];
    s.setPicks(items);
  }

  update() {
    const { s } = this;
    const st = s.state;
    if (st.round !== this.lastRound && Date.now() > this.quietUntil) {
      const sentNow = st.history.length > this.lastSentCount;
      const last = st.history.at(-1);
      if (sentNow && last) {
        const by = last.m === s.me.id ? 'Vous avez' : `${st.members.get(last.m)?.name || 'Quelqu’un'} a`;
        toast(`${by} envoyé la tournée ${last.r}. Place à la tournée ${st.round} !`, {
          action: s.isHost ? { label: 'Annuler', run: () => s.unsendRound(last.r) } : null,
          duration: 6000,
        });
      } else if (st.history.length < this.lastSentCount) {
        toast(`Envoi de la tournée ${st.round} annulé.`);
      }
      this.struck.clear();
    }
    this.lastRound = st.round;
    this.lastSentCount = st.history.length;

    if (st.host !== this.lastHost && this.lastHost && Date.now() > this.quietUntil) {
      toast(s.isHost
        ? 'Vous êtes maintenant l’hôte de la table : c’est vous qui validez les envois.'
        : `${s.hostMember?.name || 'Quelqu’un'} est maintenant l’hôte de la table.`);
    }
    this.lastHost = st.host;
    if (s.isRemoved && !this.wasRemoved && Date.now() > this.quietUntil) {
      toast('L’hôte vous a retiré·e de la table.');
    }
    this.wasRemoved = s.isRemoved;
    this.ref('removed').hidden = !s.isRemoved;

    this.updateStatus();
    this.updateMenu();
    this.renderSlate();
    this.renderTableInfo();
  }

  updateStatus() {
    const { status, pending } = this.s.syncStatus;
    const dot = app.querySelector('[data-ref="status"]');
    if (!dot) return;
    const labels = {
      online: pending ? 'Envoi en cours…' : 'Synchronisé',
      connecting: 'Connexion…',
      offline: 'Hors-ligne : vos choix partiront au retour du réseau',
    };
    dot.dataset.status = pending && status === 'online' ? 'pending' : status;
    dot.title = labels[status];
    dot.setAttribute('aria-label', labels[status]);
    app.querySelector('.topbar-sub').textContent = `Table ${this.s.code} · Tournée ${this.s.state.round}`;
  }

  updateMenu() {
    const { r, s } = this;
    const st = s.state;
    const mine = s.mine;
    const period = s.period;
    const others = new Map();
    for (const [m, { items }] of st.current) {
      if (m === s.me.id) continue;
      for (const [id, q] of Object.entries(items)) {
        if (!others.has(id)) others.set(id, []);
        others.get(id).push([m, q]);
      }
    }

    for (const row of app.querySelectorAll('[data-item]')) {
      const id = row.dataset.item;
      const item = r.itemsById.get(id);
      const qty = mine.items[id] || 0;
      const by = others.get(id) || [];
      row.querySelector('[data-qty]').textContent = qty;
      row.classList.toggle('is-picked', qty > 0);
      row.classList.toggle('is-shared', by.length > 0);
      row.classList.toggle('is-off', !r.isAvailable(item, period));
      row.querySelector('[data-who]').innerHTML = by.map(([m, q]) => memberChip(st.members.get(m), q)).join('');
      row.querySelector('[data-fav]').setAttribute('aria-pressed', this.favs.has(id));
    }

    const count = r.countPortions(mine.items);
    this.ref('mycount').innerHTML = r.limit
      ? `<b>${count}</b>/${r.limit} <span>portions · tournée ${st.round}</span>`
      : `<b>${count}</b> <span>portion${count > 1 ? 's' : ''} · tournée ${st.round}</span>`;
    this.ref('mycount').classList.toggle('is-full', !!r.limit && count >= r.limit);
    const readyBtn = app.querySelector('[data-action="ready"]');
    readyBtn.textContent = mine.ready ? '✓ Prêt·e' : 'J’ai fini';
    readyBtn.classList.toggle('btn-primary', mine.ready);

    const total = Object.values(currentPerMember(st)).reduce((n, items) => n + r.countPortions(items), 0);
    const badge = this.ref('badge');
    badge.hidden = !total;
    badge.textContent = total;

    if (this.onlySelected) this.applyFilter();
    app.querySelector('[data-action="only-selected"]').classList.toggle('is-active', this.onlySelected);
  }

  applyFilter() {
    const selected = new Set(Object.values(currentPerMember(this.s.state)).flatMap(Object.keys));
    // Pendant une recherche ou un filtre, les favoris feraient doublon.
    this.ref('favs').hidden = !!(this.query || this.onlySelected);
    let visible = 0;
    for (const section of app.querySelectorAll('[data-cat-section]')) {
      let shown = 0;
      for (const row of section.querySelectorAll('[data-item]')) {
        const ok = (!this.query || row.dataset.search.includes(this.query))
          && (!this.onlySelected || selected.has(row.dataset.item));
        row.hidden = !ok;
        if (ok) shown++;
      }
      section.hidden = !shown;
      visible += shown;
    }
    this.ref('noresult').hidden = visible > 0;
    this.ref('noresult').textContent = this.onlySelected && !this.query
      ? 'Personne n’a encore rien choisi pour cette tournée.'
      : 'Aucun plat ne correspond.';
    app.querySelector('[data-action="only-selected"]').classList.toggle('is-active', this.onlySelected);
  }

  slateRows() {
    const agg = aggregate(currentPerMember(this.s.state));
    const ids = this.r.sortIds(agg.keys());
    const food = [];
    const extras = [];
    for (const id of ids) {
      const item = this.r.itemsById.get(id);
      if (!item) continue;
      (this.r.isExtra(item) ? extras : food).push({ item, ...agg.get(id) });
    }
    return { food, extras };
  }

  slateText() {
    const { food, extras } = this.slateRows();
    const lines = [`${this.r.name} — tournée ${this.s.state.round}`];
    for (const { item, qty } of food) lines.push(`${item.n || ''}  × ${qty}   ${item.name}`);
    if (extras.length) {
      lines.push('', 'À demander au serveur :');
      for (const { item, qty } of extras) lines.push(`${qty} × ${item.name}${item.desc ? ` (${item.desc})` : ''}`);
    }
    return lines.join('\n');
  }

  renderSlate() {
    const { r, s } = this;
    const st = s.state;
    const { food, extras } = this.slateRows();
    const portions = food.reduce((n, row) => n + row.qty, 0);
    const members = [...st.members.values()];
    const ready = members.filter(m => st.current.get(m.id)?.ready);
    const waiting = members.filter(m => !st.current.get(m.id)?.ready);
    const pane = app.querySelector('[data-pane="slate"]');
    const period = s.period;

    pane.innerHTML = `
      <div class="slate-head">
        <div>
          <h2>Tournée ${st.round}</h2>
          <p class="muted">${portions} portion${portions > 1 ? 's' : ''} · ${food.length} numéro${food.length > 1 ? 's' : ''}</p>
        </div>
        <div class="ready-state ${waiting.length ? '' : 'all-ready'}">
          <b>${ready.length}/${members.length}</b> prêt${ready.length > 1 ? 's' : ''}
          ${waiting.length ? `<small>On attend : ${waiting.map(m => esc(m.name)).join(', ')}</small>` : '<small>Tout le monde a fini</small>'}
        </div>
      </div>
      ${food.length || extras.length ? `
        <div class="slate">
          <div class="slate-board">
            ${food.map(({ item, qty, by }) => `
              <button class="slate-row ${this.struck.has(item.id) ? 'is-struck' : ''} ${r.isAvailable(item, period) ? '' : 'is-off'}" data-strike="${esc(item.id)}">
                <span class="slate-num">${esc(item.n || '•')}</span>
                <span class="slate-qty">${qty}</span>
                <span class="slate-name">${item.icon ? `<span class="slate-emo" aria-hidden="true">${esc(item.icon)}</span> ` : ''}${esc(item.name)}${r.isAvailable(item, period) ? '' : ' <em>(indisponible)</em>'}
                  <span class="who">${by.map(([m, q]) => memberChip(st.members.get(m), q)).join('')}</span></span>
              </button>`).join('')}
          </div>
          <p class="hint">Touchez une ligne pour la barrer une fois recopiée.</p>
          ${extras.length ? `
            <h3 class="section-title">À demander au serveur</h3>
            <div class="list">
              ${extras.map(({ item, qty, by }) => `
                <div class="list-row">
                  <span class="slate-qty small">${qty}</span>
                  <span class="list-main"><b>${item.icon ? `${esc(item.icon)} ` : ''}${esc(item.name)}</b><small>${esc(item.desc || '')} · ${euros(item.price * qty)}</small>
                    <span class="who">${by.map(([m, q]) => memberChip(st.members.get(m), q)).join('')}</span></span>
                </div>`).join('')}
            </div>` : ''}
        </div>
        <div class="slate-actions">
          <button class="btn" data-action="copy-slate">Copier la liste</button>
          <button class="btn" data-action="print" data-doc="slate">🖨️ Imprimer</button>
          ${s.isHost ? '<button class="btn btn-primary span-2" data-action="send">Commande passée ✓</button>' : ''}
        </div>
        ${s.isHost ? '' : this.hostNoteHtml()}
        ${r.rules.wastePenalty ? `<p class="note">Rappel : ${euros(r.rules.wastePenalty)} par portion non consommée. Commandez par petites tournées !</p>` : ''}
      ` : `
        <div class="empty">
          <p>Personne n’a encore rien choisi pour la tournée ${st.round}.</p>
          <button class="btn btn-primary" data-action="go-menu">Voir le menu</button>
        </div>`}`;
  }

  hostNoteHtml() {
    const { s } = this;
    const host = s.hostMember;
    return `
      <div class="host-note">
        <span aria-hidden="true">👑</span>
        <p>${host ? `C’est <b>${esc(host.name)}</b>, l’hôte de la table, qui valide l’envoi de la tournée.` : 'Seul l’hôte de la table peut valider l’envoi de la tournée.'}
          ${s.hostIdle ? '<br><small>L’hôte ne donne plus de nouvelles depuis un moment ?</small>' : ''}</p>
        ${s.hostIdle ? '<button class="btn btn-small" data-action="claim">Prendre la main</button>' : ''}
      </div>`;
  }

  async confirmClaim() {
    const ok = await dialog({
      title: 'Prendre la main ?',
      body: `<p>${esc(this.s.hostMember?.name || 'L’hôte')} n’a rien fait depuis plus de 15 minutes. Vous deviendrez l’hôte de la table : c’est vous qui validerez les envois.</p>`,
      actions: [{ label: 'Annuler', value: false }, { label: 'Prendre la main', value: true, primary: true }],
    });
    if (ok) this.s.claimHost();
  }

  async manageMember(id) {
    const { s } = this;
    const m = s.state.members.get(id);
    if (!m || !s.isHost) return;
    const choice = await dialog({
      title: m.name,
      body: `<p>Vous êtes l’hôte de la table. Vous pouvez lui confier la table (c’est alors cette personne qui validera les envois), ou la retirer de la table si elle est partie ou s’est connectée par erreur.</p>`,
      actions: [
        { label: 'Annuler', value: false },
        { label: 'Retirer', value: 'kick' },
        { label: 'Confier la table', value: 'host', primary: true },
      ],
    });
    if (choice === 'host') s.giveHost(id);
    else if (choice === 'kick') s.removeMember(id);
  }

  async confirmSend() {
    if (!this.s.isHost) return;
    const { food, extras } = this.slateRows();
    if (!food.length && !extras.length) return;
    const ok = await dialog({
      title: `Envoyer la tournée ${this.s.state.round} ?`,
      body: '<p>À faire une fois l’ardoise remise au serveur. Les sélections de chacun seront remises à zéro pour la tournée suivante.</p>',
      actions: [{ label: 'Pas encore', value: false }, { label: 'C’est envoyé', value: true, primary: true }],
    });
    if (ok) this.s.sendRound();
  }

  renderTableInfo() {
    const { r, s } = this;
    const st = s.state;
    const period = s.period;
    const { status, pending } = s.syncStatus;
    const box = this.ref('table-dynamic');
    const members = [...st.members.values()];
    const lastRound = st.history.at(-1)?.r;

    const syncText = {
      online: pending ? `Envoi de ${pending} modification${pending > 1 ? 's' : ''}…` : 'Synchronisé avec la table',
      connecting: 'Connexion au relais…',
      offline: `Hors-ligne${pending ? ` · ${pending} modification${pending > 1 ? 's' : ''} en attente` : ''}`,
    }[status];

    const host = s.hostMember;
    box.innerHTML = `
      <p class="sync-line" data-status="${status}"><span class="dot"></span>${esc(syncText)}</p>

      <section class="card host-card">
        <span class="host-crown" aria-hidden="true">👑</span>
        <div class="list-main">
          <b>${s.isHost ? 'Vous êtes l’hôte de la table' : `Hôte : ${esc(host?.name || '…')}`}</b>
          <small>${s.isHost
            ? 'Vous validez l’envoi des tournées et choisissez la formule. Touchez « Gérer » à côté d’un convive pour lui confier la table.'
            : 'L’hôte valide l’envoi des tournées et choisit la formule.'}</small>
        </div>
        ${s.hostIdle ? '<button class="btn btn-small" data-action="claim">Prendre la main</button>' : ''}
      </section>

      ${r.periods.length ? `
        <section class="card">
          <h2 class="card-title">Formule</h2>
          <div class="segmented">
            ${r.periods.map(p => `
              <button data-action="period" data-period="${esc(p.id)}" aria-pressed="${p.id === period}" ${s.isHost ? '' : 'disabled'}>
                <b>${esc(p.label)}</b><small>${euros(p.prices.adulte ?? 0)}</small>
              </button>`).join('')}
          </div>
          <p class="muted small">${esc(r.periodById(period)?.hint || '')}${s.isHost ? '' : ' · Choisie par l’hôte.'}</p>
        </section>` : ''}

      <section class="card">
        <h2 class="card-title">Convives <span class="muted">(${members.length})</span></h2>
        <div class="members">
          ${members.map(m => {
            const cur = st.current.get(m.id);
            const n = cur ? r.countPortions(cur.items) : 0;
            const me = m.id === s.me.id;
            return `
              <div class="member">
                ${avatar(m)}
                <div class="list-main"><b>${esc(m.name)}${me ? ' <span class="muted">(moi)</span>' : ''}${m.id === st.host ? ' <span class="host-tag">hôte</span>' : ''}</b>
                  <small>${esc(r.guestLabel(m.kind))} · ${n} portion${n > 1 ? 's' : ''}</small></div>
                <span class="state ${cur?.ready ? 'ok' : ''}">${cur?.ready ? '✓ prêt·e' : 'choisit…'}</span>
                ${me ? '<button class="btn btn-small" data-action="profile">Modifier</button>' : ''}
                ${!me && s.isHost ? `<button class="btn btn-small" data-action="manage" data-member="${esc(m.id)}">Gérer</button>` : ''}
              </div>`;
          }).join('')}
        </div>
      </section>

      ${st.history.length ? `
        <section class="card">
          <h2 class="card-title">Tournées envoyées</h2>
          ${[...st.history].reverse().map(h => {
            const agg = aggregate(h.per || {});
            const ids = r.sortIds(agg.keys());
            const n = ids.reduce((acc, id) => acc + (r.isExtra(r.itemsById.get(id) || {}) ? 0 : agg.get(id).qty), 0);
            return `
              <details class="history">
                <summary><b>Tournée ${h.r}</b><span class="muted">${timeLabel(h.ts)} · ${n} portion${n > 1 ? 's' : ''}</span></summary>
                <ul>
                  ${ids.map(id => {
                    const item = r.itemsById.get(id);
                    return `<li><span class="num small">${esc(item?.n || '•')}</span> ${agg.get(id).qty} × ${item?.icon ? `${esc(item.icon)} ` : ''}${esc(item?.name || id)}</li>`;
                  }).join('')}
                </ul>
                ${h.r === lastRound && s.isHost ? `<button class="btn btn-small" data-action="unsend" data-round="${h.r}">Annuler cet envoi</button>` : ''}
              </details>`;
          }).join('')}
        </section>` : ''}

      ${this.billHtml(members, period)}

      <section class="card">
        <h2 class="card-title">Imprimer</h2>
        <p class="muted small">Un petit document pour imprimante (ticket 58 / 80 mm ou feuille A4), ou en texte pour une appli d’imprimante thermique.</p>
        <div class="print-actions">
          <button class="btn" data-action="print" data-doc="slate">Tournée en cours</button>
          <button class="btn" data-action="print" data-doc="recap">Récapitulatif</button>
          <button class="btn" data-action="print" data-doc="invite">QR code de la table</button>
        </div>
      </section>

      ${infoHtml(r)}

      <button class="btn btn-block btn-ghost" data-action="leave">Quitter la table</button>
      <p class="muted small center">Les données de la table sont relayées par ${esc(new URL(RELAY_URL).host)} et effacées au bout de quelques heures.</p>`;
  }

  /* ----- Documents imprimables ----- */

  docHeader(subtitle) {
    const when = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    return [
      { t: 'title', text: this.r.name },
      { t: 'text', text: subtitle, center: true },
      { t: 'text', text: `Table ${this.s.code} · ${when}`, center: true, small: true },
      { t: 'hr' },
    ];
  }

  itemLines(agg) {
    return this.r.sortIds(agg.keys()).map(id => {
      const item = this.r.itemsById.get(id);
      return { t: 'line', n: item?.n || '•', qty: agg.get(id).qty, text: item?.name || id, sub: this.r.isExtra(item || {}) ? item?.desc : '' };
    });
  }

  slateDoc() {
    const { food, extras } = this.slateRows();
    const portions = food.reduce((n, row) => n + row.qty, 0);
    const doc = [...this.docHeader(`Tournée ${this.s.state.round}`)];
    if (!food.length && !extras.length) doc.push({ t: 'text', text: 'Rien de choisi pour cette tournée.', center: true });
    for (const { item, qty } of food) doc.push({ t: 'line', n: item.n || '•', qty, text: item.name });
    if (food.length) doc.push({ t: 'hr' }, { t: 'kv', k: 'Portions', v: portions, bold: true });
    if (extras.length) {
      doc.push({ t: 'gap' }, { t: 'text', text: 'À demander au serveur :' });
      for (const { item, qty } of extras) doc.push({ t: 'line', n: '•', qty, text: item.name, sub: item.desc });
    }
    return doc;
  }

  recapDoc() {
    const { r, s } = this;
    const st = s.state;
    const doc = [...this.docHeader('Récapitulatif de la table')];
    if (!st.history.length) doc.push({ t: 'text', text: 'Aucune tournée envoyée pour l’instant.', center: true });
    for (const h of st.history) {
      doc.push({ t: 'kv', k: `Tournée ${h.r}`, v: timeLabel(h.ts), bold: true }, ...this.itemLines(aggregate(h.per || {})), { t: 'gap' });
    }
    const members = [...st.members.values()];
    const bill = this.billRows(members, s.period);
    if (bill) {
      doc.push({ t: 'hr' }, { t: 'text', text: `Addition estimée · ${r.periodById(s.period)?.label || ''}` });
      for (const { m, formula, extras, total } of bill.rows) {
        doc.push({ t: 'kv', k: `${m.name} (${r.guestLabel(m.kind)})`, v: euros(total) });
        if (extras) doc.push({ t: 'text', text: `  formule ${euros(formula)} + suppl. ${euros(extras)}`, small: true });
      }
      doc.push({ t: 'hr' }, { t: 'kv', k: 'Total table', v: euros(bill.total), bold: true },
        { t: 'text', text: 'Montant indicatif, hors pénalités. Seule l’addition du restaurant fait foi.', small: true });
    }
    return doc;
  }

  inviteDoc() {
    return [
      { t: 'title', text: this.r.name },
      { t: 'text', text: 'Commandez depuis votre téléphone', center: true },
      { t: 'hr' },
      { t: 'qr', data: tableUrl(this.s) },
      { t: 'text', text: 'Code de la table', center: true, small: true },
      { t: 'big', text: this.s.code },
      { t: 'text', text: 'Scannez le QR code, ou ouvrez le lien ci-dessous et entrez le code.', center: true, small: true },
      { t: 'text', text: tableUrl(this.s), center: true, small: true },
    ];
  }

  async openPrint(kind) {
    const docs = {
      slate: ['Imprimer la tournée', () => this.slateDoc()],
      recap: ['Imprimer le récapitulatif', () => this.recapDoc()],
      invite: ['Imprimer le QR code', () => this.inviteDoc()],
    };
    const [title, build] = docs[kind] || docs.slate;
    const doc = build();
    let format = preferredFormat();
    const choice = await dialog({
      title,
      body: `
        <div class="segmented segmented-small" role="radiogroup" aria-label="Format du papier">
          ${Object.entries(FORMATS).map(([id, f]) => `
            <label><input type="radio" name="format" value="${id}" ${id === format ? 'checked' : ''}><span>${esc(f.label)}</span></label>`).join('')}
        </div>
        <div class="paper-preview"><div class="paper paper-${format}" data-preview>${toHtml(doc)}</div></div>`,
      actions: [
        { label: 'Fermer', value: false },
        { label: 'Texte', value: 'text' },
        { label: 'Imprimer', value: 'print', primary: true },
      ],
      onOpen: dlg => dlg.addEventListener('change', ev => {
        if (ev.target.name !== 'format') return;
        format = ev.target.value;
        rememberFormat(format);
        dlg.querySelector('[data-preview]').className = `paper paper-${format}`;
      }),
    });
    if (choice === 'print') printDoc(doc, format);
    else if (choice === 'text') shareText(toText(doc, format), `${this.r.name} · Table ${this.s.code}`);
  }

  billRows(members, period) {
    const { r, s } = this;
    const extrasBy = new Map();
    for (const h of s.state.history) {
      for (const [m, items] of Object.entries(h.per || {})) {
        for (const [id, q] of Object.entries(items)) {
          const price = r.itemsById.get(id)?.price || 0;
          if (price) extrasBy.set(m, (extrasBy.get(m) || 0) + price * q);
        }
      }
    }
    if (!r.periods.length && !extrasBy.size) return null;
    const rows = members.map(m => {
      const formula = r.formulaPrice(m.kind, period);
      const extras = extrasBy.get(m.id) || 0;
      return { m, formula, extras, total: formula + extras };
    });
    return { rows, total: rows.reduce((acc, row) => acc + row.total, 0) };
  }

  billHtml(members, period) {
    const bill = this.billRows(members, period);
    if (!bill) return '';
    const { rows, total } = bill;
    return `
      <section class="card">
        <h2 class="card-title">Addition estimée</h2>
        <table class="bill">
          <thead><tr><th>Convive</th><th>Formule</th><th>Suppl.</th><th>Total</th></tr></thead>
          <tbody>
            ${rows.map(({ m, formula, extras, total: t }) => `
              <tr><td>${esc(m.name)}</td><td>${euros(formula)}</td><td>${extras ? euros(extras) : '—'}</td><td><b>${euros(t)}</b></td></tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="3">Total table</td><td><b>${euros(total)}</b></td></tr></tfoot>
        </table>
        <p class="muted small">Selon la formule choisie et les suppléments/boissons des tournées envoyées. Indicatif, hors pénalités.</p>
      </section>`;
  }
}

/* ---------- Profil ---------- */

async function editProfile(r, { first = false } = {}) {
  const result = await dialog({
    title: first ? 'Qui êtes-vous ?' : 'Mon profil',
    body: `
      <label class="field">Prénom
        <input class="input" name="name" maxlength="20" required autocomplete="given-name" value="${esc(profile.name)}" placeholder="Ex. : Camille">
      </label>
      <fieldset class="field">
        <legend>Formule</legend>
        <div class="segmented">
          ${r.guests.map(g => `
            <label><input type="radio" name="kind" value="${esc(g.id)}" ${g.id === profile.kind ? 'checked' : ''}><span>${esc(g.label)}</span></label>`).join('')}
        </div>
      </fieldset>`,
    actions: [
      { label: 'Annuler', value: false },
      { label: first ? 'Rejoindre la table' : 'Enregistrer', value: 'form', primary: true },
    ],
  });
  if (!result) return false;
  const name = String(result.get('name') || '').trim().slice(0, 20);
  if (!name) return false;
  profile.name = name;
  profile.kind = result.get('kind') || profile.kind || 'adulte';
  save(PROFILE_KEY, profile);
  return true;
}

/* ---------- Composants ---------- */

function topbar({ title, subtitle = '', back = null, status = false }) {
  return `
    <header class="topbar">
      ${back ? `<a class="back" href="${esc(back)}" aria-label="Retour">‹</a>` : '<span class="logo" aria-hidden="true">板</span>'}
      <div class="topbar-text">
        <div class="topbar-title">${esc(title)}</div>
        ${subtitle ? `<div class="topbar-sub">${esc(subtitle)}</div>` : ''}
      </div>
      ${status ? '<span class="status-dot" data-ref="status" role="img"></span>' : ''}
    </header>`;
}

function avatar(m) {
  return `<span class="avatar" style="--hue:${memberHue(m?.id || '')}">${esc(initials(m?.name))}</span>`;
}

function memberChip(m, q) {
  return `<span class="mchip" style="--hue:${memberHue(m?.id || '')}">${esc(m?.name || '?')}${q > 1 ? ` ×${q}` : ''}</span>`;
}

// « 🍣🥑 » → ['🍣', '🥑'] : l'émoji principal et l'ingrédient affiché en médaillon.
function emojiParts(icon) {
  return String(icon || '').match(/\p{Extended_Pictographic}\uFE0F?/gu) || [];
}

function tableUrl(s) {
  const url = new URL(location.href);
  url.hash = `#/r/${s.restaurant.id}/t/${s.code}`;
  return url.toString();
}

async function shareTable(s) {
  const url = tableUrl(s);
  if (navigator.share) {
    try {
      await navigator.share({ title: `${s.restaurant.name} · Table ${s.code}`, text: 'Rejoins notre table pour commander :', url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  copyText(url, 'Lien copié');
}

// Le texte brut part vers une appli d'impression (thermique Bluetooth…) via
// le partage du téléphone, ou à défaut dans le presse-papiers.
async function shareText(text, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  copyText(text, 'Texte copié');
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const area = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    toast(ok ? message : 'Impossible de copier');
  }
}

let toastTimer = null;
function toast(message, { action = null, duration = 2800 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) {
    el.querySelector('button').onclick = () => {
      el.classList.remove('is-visible');
      action.run();
    };
  }
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
}

// Fenêtre modale. Une action de valeur 'form' renvoie le FormData du contenu.
function dialog({ title, body, actions, onOpen = null }) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        <div class="dialog-body">${body}</div>
        <div class="dialog-actions">
          ${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : ''}" value="${i}" ${a.value === 'form' ? '' : 'formnovalidate'}>${esc(a.label)}</button>`).join('')}
        </div>
      </form>`;
    document.body.append(dlg);
    const form = dlg.querySelector('form');
    dlg.addEventListener('close', () => {
      const action = actions[Number(dlg.returnValue)];
      const value = action ? action.value : false;
      resolve(value === 'form' ? new FormData(form) : value);
      dlg.remove();
    });
    dlg.showModal();
    onOpen?.(dlg);
    dlg.querySelector('input:not([type=radio])')?.focus();
  });
}
