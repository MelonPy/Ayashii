// Synchronisation entre les téléphones d'une même table.
//
// GitHub Pages ne sert que des fichiers statiques : on passe donc par un relais
// pub/sub public compatible ntfy (https://ntfy.sh par défaut, sans compte).
// Chaque table = un « topic ». Chaque action (choix, envoi d'une tournée…) est
// publiée comme un message JSON ; ntfy garde les messages ~12 h, ce qui permet
// à un nouvel arrivant de rejouer tout l'historique de la table.

import { load, save } from './util.js';

const MAX_BACKOFF = 30_000;

export class Relay {
  constructor({ base, topic, outboxKey, onMessage, onStatus }) {
    this.base = base;
    this.topic = topic;
    this.outboxKey = outboxKey;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.outbox = load(outboxKey, []);
    this.since = 'all';
    this.status = 'connecting';
    this.retries = 0;
    this.es = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
    this.flushing = false;
    this.stopped = false;
    this.handleWake = () => {
      if (document.visibilityState === 'hidden') return;
      if (!this.es) this.connect();
      this.flush();
    };
  }

  start() {
    this.connect();
    window.addEventListener('online', this.handleWake);
    document.addEventListener('visibilitychange', this.handleWake);
    if (this.outbox.length) this.flush();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.flushTimer);
    this.es?.close();
    this.es = null;
    window.removeEventListener('online', this.handleWake);
    document.removeEventListener('visibilitychange', this.handleWake);
  }

  get pending() {
    return this.outbox.length;
  }

  setStatus(status) {
    this.status = status;
    this.onStatus?.(status, this.pending);
  }

  connect() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.es?.close();
    this.setStatus('connecting');
    const es = new EventSource(`${this.base}/${this.topic}/sse?since=${encodeURIComponent(this.since)}`);
    this.es = es;
    es.onopen = () => {
      this.retries = 0;
      this.setStatus('online');
      this.flush();
    };
    es.onmessage = ev => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.event && msg.event !== 'message') return;
      if (msg.id) this.since = msg.id;
      let payload;
      try {
        payload = JSON.parse(msg.message);
      } catch {
        return;
      }
      this.onMessage(payload);
    };
    es.onerror = () => {
      // On gère la reconnexion nous-mêmes pour repartir du dernier message reçu.
      es.close();
      if (this.es !== es) return;
      this.es = null;
      this.setStatus('offline');
      const delay = Math.min(MAX_BACKOFF, 1000 * 2 ** this.retries++);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  // `key` permet de remplacer un message pas encore envoyé (ex. : la sélection
  // d'une personne, modifiée plusieurs fois de suite) au lieu d'empiler les envois.
  publish(payload, key = null) {
    if (key) this.outbox = this.outbox.filter(o => o.key !== key);
    this.outbox.push({ key, body: JSON.stringify(payload) });
    save(this.outboxKey, this.outbox);
    this.onStatus?.(this.status, this.pending);
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), key ? 400 : 0);
  }

  async flush() {
    if (this.flushing || this.stopped) return;
    this.flushing = true;
    try {
      while (this.outbox.length && !this.stopped) {
        const entry = this.outbox[0];
        const res = await fetch(`${this.base}/${this.topic}`, { method: 'POST', body: entry.body });
        // 4xx hors 429 : le message ne passera jamais (trop gros, refusé) → on l'abandonne.
        if (!res.ok && (res.status === 429 || res.status >= 500)) throw new Error(`HTTP ${res.status}`);
        this.outbox = this.outbox.filter(o => o !== entry);
        save(this.outboxKey, this.outbox);
        this.onStatus?.(this.status, this.pending);
      }
    } catch {
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => this.flush(), 3000);
    } finally {
      this.flushing = false;
    }
  }
}
