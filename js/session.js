// Une table ouverte sur ce téléphone : journal d'événements local + relais.

import { Relay } from './sync.js';
import { EventLog, PROTOCOL, derive, currentPerMember } from './store.js';
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

  get mine() {
    return this.state.current.get(this.me.id) || { items: {}, ready: false };
  }

  get syncStatus() {
    return { status: this.relay.status, pending: this.relay.pending };
  }

  join({ isNew = false } = {}) {
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
    const r = this.state.round;
    this.emit('send', { r, per: currentPerMember(this.state) });
    return r;
  }

  unsendRound(r) {
    if (this.state.history.at(-1)?.r === r) this.emit('unsend', { r });
  }

  setPeriod(period) {
    this.emit('settings', { period });
  }
}
