// Lokal lagring i nettleserens IndexedDB. Brukes til demo og testing.
// Samme grensesnitt som GitHubBackend; innholdet er kryptert på samme måte.

import { idbGet, idbSet, idbDel } from './idb.js';

export class LocalBackend {
  constructor({ name = 'standard' } = {}) {
    this.name = name;
  }

  get label() {
    return 'Lokalt i denne nettleseren';
  }

  async check() {
    return { private: true };
  }

  async readText(p) {
    const v = await idbGet('filer', `${this.name}:${p}`);
    return v ?? null;
  }

  async writeText(p, text) {
    await idbSet('filer', `${this.name}:${p}`, text);
  }

  async deleteFile(p) {
    await idbDel('filer', `${this.name}:${p}`);
  }
}
