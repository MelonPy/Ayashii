// Chargement et lecture des menus (un fichier JSON par restaurant dans /restaurants).

const cache = new Map();
let indexPromise = null;

export function listRestaurants() {
  indexPromise ??= fetch('restaurants/index.json')
    .then(res => res.json())
    .then(list => Promise.all(list.map(entry => getRestaurant(entry.id, entry.file))));
  return indexPromise;
}

export async function getRestaurant(id, file = `${id}.json`) {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  if (!cache.has(id)) {
    cache.set(id, fetch(`restaurants/${file}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => (data ? new Restaurant(data) : null))
      .catch(() => null));
  }
  return cache.get(id);
}

class Restaurant {
  constructor(data) {
    Object.assign(this, data);
    this.rules ??= {};
    this.periods ??= [];
    this.guests ??= [{ id: 'adulte', label: 'Adulte' }];
    // Suggestions de la maison, affichées dans « Favoris » tant que le convive
    // n'a pas encore choisi les siens.
    this.favorites ??= [];
    this.info ??= {};
    this.categoriesById = new Map(this.categories.map(c => [c.id, c]));
    // Sans illustration propre, un plat prend l'émoji de sa catégorie.
    this.items = this.items.map((item, order) => ({
      ...item,
      id: item.id || item.n,
      icon: item.icon || this.categoriesById.get(item.cat)?.icon || '',
      order,
    }));
    this.itemsById = new Map(this.items.map(item => [item.id, item]));
    this.favorites = this.favorites.filter(id => this.itemsById.has(id));
  }

  // Limite de portions par personne et par tournée : proposée dans les
  // réglages de la table, désactivée par défaut sauf `rules.limitByDefault`.
  get suggestedLimit() {
    return this.rules.maxPerRound || 5;
  }

  get defaultLimit() {
    return this.rules.limitByDefault ? this.suggestedLimit : 0;
  }

  // Les boissons & co. sont payantes : hors limite par tournée, hors ardoise.
  isExtra(item) {
    return !!this.categoriesById.get(item.cat)?.extra;
  }

  periodsOf(item) {
    return item.periods || this.categoriesById.get(item.cat)?.periods || null;
  }

  isAvailable(item, period) {
    const periods = this.periodsOf(item);
    return !periods || !period || periods.includes(period);
  }

  periodById(id) {
    return this.periods.find(p => p.id === id) || null;
  }

  // La première période dont l'horaire correspond, sinon celle sans horaire.
  detectPeriod(date = new Date()) {
    const minutes = date.getHours() * 60 + date.getMinutes();
    const toMin = hhmm => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const match = this.periods.find(p => p.schedule
      && p.schedule.days.includes(date.getDay())
      && minutes >= toMin(p.schedule.from) && minutes < toMin(p.schedule.to));
    return (match || this.periods.find(p => !p.schedule) || this.periods[0])?.id || null;
  }

  formulaPrice(kind, period) {
    return this.periodById(period)?.prices?.[kind] ?? 0;
  }

  guestLabel(kind) {
    return this.guests.find(g => g.id === kind)?.label || kind;
  }

  countPortions(items) {
    let n = 0;
    for (const [id, q] of Object.entries(items)) {
      const item = this.itemsById.get(id);
      if (item && !this.isExtra(item)) n += q;
    }
    return n;
  }

  sortIds(ids) {
    return [...ids].sort((a, b) => (this.itemsById.get(a)?.order ?? 1e9) - (this.itemsById.get(b)?.order ?? 1e9));
  }
}
