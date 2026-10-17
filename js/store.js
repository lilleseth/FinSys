// Appens tilstand: databasen i minnet, automatisk lagring og endringsvarsler.

import { STANDARD_KATEGORIER } from './model/categories.js';

export const SCHEMA = 1;

export function nyDatabase() {
  return {
    schema: SCHEMA,
    opprettet: new Date().toISOString(),
    kontoer: [],
    kategorier: structuredClone(STANDARD_KATEGORIER),
    innstillinger: { nodvendigeUtgifterPerMnd: null, skatt: { rentefradrag: 0.22, bunnfradrag: 1900000, formuesskattSats: 0.01, rabattAksjer: 0.2 } },
    budsjett: { poster: {}, perAar: {} },
    regler: [],
    transaksjonsAr: [],
    transaksjoner: [],
    formue: { poster: [], historikk: [], utbytte: [] },
    inntekt: { lonnsslipper: [] },
    notater: [],
    dokumenter: [],
    planlagt: [],
    mal: [],
    skatt: {},
  };
}

const listeners = new Set();
let timer = null;
let lagrer = null;

export const store = {
  db: null,
  vault: null,
  status: 'lagret', // 'lagret' | 'endret' | 'lagrer' | 'feil'
  feil: '',

  init(vault, db) {
    this.vault = vault;
    this.db = db;
    this.status = 'lagret';
  },

  on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  emit(kind) {
    for (const fn of listeners) fn(kind);
  },

  // Kalles etter hver endring i databasen.
  changed() {
    this.status = 'endret';
    this.emit('status');
    clearTimeout(timer);
    timer = setTimeout(() => this.save(), 1500);
  },

  async save() {
    clearTimeout(timer);
    if (lagrer) { await lagrer; }
    if (!this.vault || !this.db) return;
    this.status = 'lagrer';
    this.emit('status');
    lagrer = (async () => {
      try {
        await this.vault.save(this.db);
        this.status = this.vault.hasChanges(this.db) ? 'endret' : 'lagret';
        this.feil = '';
      } catch (e) {
        console.error(e);
        this.status = 'feil';
        this.feil = e.message;
      } finally {
        lagrer = null;
        this.emit('status');
      }
    })();
    return lagrer;
  },

  ulagret() {
    return this.status === 'endret' || this.status === 'lagrer' || this.status === 'feil';
  },
};
