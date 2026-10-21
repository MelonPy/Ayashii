// Une table ouverte sur ce téléphone : journal d'événements local + relais.

import { Relay } from './sync.js';
import { EventLog, PROTOCOL, HOST_IDLE_MS, derive, currentPerMember } from './store.js';
import { uid } from './util.js';

const params = new URLSearchParams(location.search);
// `?relay=http://localhost:8787` pour tester avec tools/dev-server.mjs.
export const RELAY_URL = (params.get('relay') || 'https://ntfy.sh').replace(/\/+$/, '');
const TOPIC_PREFIX = 'ardoise-v1';

export class TableSession {
  constructor(restaurant, code, profile) {
    this.restaurant = restaurant;
    this.code = code;
    this.me = profile;
    this.lastTs = 0;
    this.listeners = new Set();
    const key = `ayashii.${restaurant.id}.${code}`;
    this.log = new EventLog(`${key}.events`);
    this.relay = new Relay({
      base: RELAY_URL,
      topic: `${TOPIC_PREFIX}-${restaurant.id}-${code}`,
      outboxKey: `${key}.outbox`,
      onMessage: e => {
        if (this.log.add(e)) this.changed();
      },
      onStatus: () => this.notify(),
    });
    this.state = derive(this.log.events.values());
  }

  start() {
    this.relay.start();
  }

  stop() {
    this.relay.stop();
    this.listeners.clear();
  }

  on(fn) {
    this.listeners.add(fn);
  }

  notify() {
    for (const fn of this.listeners) fn(this.state);
  }

  changed() {
    this.state = derive(this.log.events.values());
    this.notify();
  }

  emit(t, data, coalesceKey = null) {
    // Horodatage strictement croissant : deux clics dans la même milliseconde
    // doivent garder leur ordre.
    this.lastTs = Math.max(Date.now(), this.lastTs + 1);
    const e = { v: PROTOCOL, cid: uid(), ts: this.lastTs, m: this.me.id, t, ...data };
    this.log.add(e);
    this.relay.publish(e, coalesceKey);
    this.changed();
    return e;
  }

  get period() {
    return this.state.period || this.restaurant.detectPeriod();
  }

  // 0 = pas de limite.
  get limit() {
    return this.state.limit ?? this.restaurant.defaultLimit;
  }

  get mine() {
    return this.state.current.get(this.me.id) || { items: {}, ready: false };
  }

  get isHost() {
    return this.state.host === this.me.id;
  }

  get hostMember() {
    return this.state.members.get(this.state.host) || null;
  }

  get isRemoved() {
    return this.state.removed.has(this.me.id);
  }

  // L'hôte n'a rien fait depuis longtemps (téléphone éteint, parti…).
  get hostIdle() {
    const seen = this.state.lastSeen.get(this.state.host) ?? 0;
    return !this.isHost && Date.now() - seen >= HOST_IDLE_MS;
  }

  get syncStatus() {
    return { status: this.relay.status, pending: this.relay.pending };
  }

  // `force` : revenir après avoir été retiré·e de la table par l'hôte.
  join({ isNew = false, force = false } = {}) {
    if (isNew && !this.state.host) this.emit('open', {});
    if (this.isRemoved && !force) return;
    const m = this.state.members.get(this.me.id);
    if (!m || m.name !== this.me.name || m.kind !== this.me.kind) {
      this.emit('member', { name: this.me.name, kind: this.me.kind });
    }
    if (isNew && !this.state.period) this.emit('settings', { period: this.restaurant.detectPeriod() });
  }

  setPicks(items, ready = this.mine.ready) {
    const r = this.state.round;
    this.emit('picks', { r, items, ready, name: this.me.name }, `picks|${r}`);
  }

  sendRound() {
    if (!this.isHost) return null;
    const r = this.state.round;
    this.emit('send', { r, per: currentPerMember(this.state) });
    return r;
  }

  unsendRound(r) {
    if (this.isHost && this.state.history.at(-1)?.r === r) this.emit('unsend', { r });
  }

  setPeriod(period) {
    if (this.isHost) this.emit('settings', { period });
  }

  setLimit(limit) {
    if (this.isHost) this.emit('settings', { limit: Math.max(0, Math.min(99, limit)) });
  }

  setTableLabel(tableLabel) {
    if (this.isHost) this.emit('settings', { tableLabel });
  }

  giveHost(to) {
    if (this.isHost && to !== this.me.id) this.emit('host', { to });
  }

  claimHost() {
    if (this.hostIdle) this.emit('claim', {});
  }

  removeMember(target) {
    if (this.isHost && target !== this.me.id) this.emit('kick', { target });
  }
}
