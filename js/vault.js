// Hvelvet: nøkkelhåndtering, kryptering og oppdeling av databasen i filer (GitHub eller lokalt).

import {
  deriveKey, deriveKek, nyDatanokkel, pakkInn, pakkUt, ikkeEksporterbar,
  nyGjenopprettingsnokkel, normaliserGjenoppretting,
  encryptText, decryptText, encryptBytes, decryptBytes, randomBytes, toB64,
  KDF_ITERATIONS, KDF_ITERATIONS_GJENOPPRETTING,
} from './crypto.js';
import { idbGet, idbSet, idbDel } from './storage/idb.js';
import { uid } from './util.js';

const META = 'finsys.json';
const CHECK = 'finsys-ok';

const kdfNy = (iterations) => ({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(randomBytes(16)) });

export class Vault {
  constructor(backend) {
    this.backend = backend;
    this.key = null; // datanøkkel (ikke-eksporterbar)
    this.meta = null;
    this.husket = false;
    this.saved = new Map(); // sti -> sist lagrede klartekst
  }

  get harGjenoppretting() {
    return this.meta?.format === 2 && this.meta.nokler.some((n) => n.type === 'gjenoppretting');
  }

  get nokkelId() {
    return this.meta?.id || `${this.backend?.label}|${this.meta?.kdf?.salt}`;
  }

  async loadMeta() {
    const text = await this.backend.readText(META);
    this.meta = text ? JSON.parse(text) : null;
    return this.meta;
  }

  async skrivMeta(melding) {
    await this.backend.writeText(META, JSON.stringify(this.meta, null, 2) + '\n', melding);
  }

  async create(password) {
    const dek = await nyDatanokkel();
    const kdf = kdfNy(KDF_ITERATIONS);
    const kek = await deriveKek(password, kdf.salt, kdf.iterations);
    this.meta = {
      app: 'FinSys',
      format: 2,
      id: 'v-' + uid(),
      opprettet: new Date().toISOString(),
      krevAad: true,
      nokler: [{ type: 'passord', kdf, ...(await pakkInn(kek, dek)) }],
      kontroll: await encryptText(dek, CHECK, META),
    };
    await this.skrivMeta('FinSys: opprett hvelv');
    this.key = await ikkeEksporterbar(dek);
  }

  async verify(key, meta = this.meta) {
    try {
      return (await decryptText(key, meta.kontroll, META)) === CHECK;
    } catch {
      return false;
    }
  }

  async unlock(password) {
    if (this.meta.format === 1) {
      const { salt, iterations } = this.meta.kdf;
      const key = await deriveKey(password, salt, iterations);
      if (!(await this.verify(key))) return false;
      this.key = key;
      this.passordForOppgradering = password;
      return true;
    }
    const n = this.meta.nokler.find((x) => x.type === 'passord');
    try {
      const kek = await deriveKek(password, n.kdf.salt, n.kdf.iterations);
      const key = await pakkUt(kek, n);
      if (!(await this.verify(key))) return false;
      this.key = key;
      if (this.meta.rotasjon) this.gammelKey = await pakkUt(kek, this.meta.rotasjon);
      return true;
    } catch {
      return false;
    }
  }

  async unlockGjenoppretting(kode) {
    const n = this.meta.format === 2 && this.meta.nokler.find((x) => x.type === 'gjenoppretting');
    if (!n) return false;
    try {
      const kek = await deriveKek(normaliserGjenoppretting(kode), n.kdf.salt, n.kdf.iterations);
      const key = await pakkUt(kek, n);
      if (!(await this.verify(key))) return false;
      this.key = key;
      return true;
    } catch {
      return false;
    }
  }

  // Henter en eksporterbar datanøkkel ved hjelp av passord eller gjenopprettingsnøkkel.
  async eksporterbarNokkel({ passord, gjenoppretting }) {
    if (this.meta.format === 1) {
      const key = await deriveKey(passord, this.meta.kdf.salt, this.meta.kdf.iterations, true);
      if (!(await this.verify(key))) throw new Error('Feil passord.');
      return key;
    }
    const type = passord != null ? 'passord' : 'gjenoppretting';
    const n = this.meta.nokler.find((x) => x.type === type);
    const hemmelighet = passord != null ? passord : normaliserGjenoppretting(gjenoppretting);
    try {
      const kek = await deriveKek(hemmelighet, n.kdf.salt, n.kdf.iterations);
      return await pakkUt(kek, n, true);
    } catch {
      throw new Error(type === 'passord' ? 'Feil passord.' : 'Feil gjenopprettingsnøkkel.');
    }
  }

  // Oppgraderer eldre hvelv (format 1) til format 2 med innpakket datanøkkel.
  // Datanøkkelen beholdes, så ingen data må krypteres på nytt for å kunne leses.
  async oppgrader(password) {
    if (this.meta.format !== 1) return false;
    const dek = await this.eksporterbarNokkel({ passord: password });
    const kdf = kdfNy(KDF_ITERATIONS);
    const kek = await deriveKek(password, kdf.salt, kdf.iterations);
    const gammelId = this.nokkelId;
    this.meta = {
      app: 'FinSys',
      format: 2,
      id: 'v-' + uid(),
      opprettet: this.meta.opprettet,
      oppgradert: new Date().toISOString(),
      krevAad: false, // settes når alle datafiler er skrevet på nytt med filsti-binding
      nokler: [{ type: 'passord', kdf, ...(await pakkInn(kek, dek)) }],
      kontroll: await encryptText(dek, CHECK, META),
    };
    await this.skrivMeta('FinSys: oppgrader nøkkelhåndtering');
    await idbDel('nokler', gammelId);
    this.saved.clear(); // tving ny kryptering av alle datafiler ved neste lagring
    this.passordForOppgradering = null;
    return true;
  }

  async byttPassord(bevis, nyttPassord) {
    const dek = await this.eksporterbarNokkel(bevis);
    const kdf = kdfNy(KDF_ITERATIONS);
    const kek = await deriveKek(nyttPassord, kdf.salt, kdf.iterations);
    const ny = { type: 'passord', kdf, ...(await pakkInn(kek, dek)) };
    this.meta.nokler = [ny, ...this.meta.nokler.filter((n) => n.type !== 'passord')];
    await this.skrivMeta('FinSys: bytt passord');
  }

  // Lager (eller erstatter) gjenopprettingsnøkkelen. Returnerer koden som må tas vare på.
  async lagGjenoppretting(bevis) {
    const dek = await this.eksporterbarNokkel(bevis);
    const kode = nyGjenopprettingsnokkel();
    const kdf = kdfNy(KDF_ITERATIONS_GJENOPPRETTING);
    const kek = await deriveKek(normaliserGjenoppretting(kode), kdf.salt, kdf.iterations);
    const ny = { type: 'gjenoppretting', kdf, opprettet: new Date().toISOString(), ...(await pakkInn(kek, dek)) };
    this.meta.nokler = [...this.meta.nokler.filter((n) => n.type !== 'gjenoppretting'), ny];
    await this.skrivMeta('FinSys: ny gjenopprettingsnøkkel');
    return kode;
  }

  // Husk datanøkkelen på denne enheten (ikke-eksporterbar CryptoKey i IndexedDB).
  async rememberKey() {
    await idbSet('nokler', this.nokkelId, this.key);
    this.husket = true;
  }

  async tryRememberedKey() {
    if (this.meta?.rotasjon) return false; // en avbrutt nøkkelrotasjon må fullføres med passord
    const key = await idbGet('nokler', this.nokkelId);
    if (key && (await this.verify(key))) {
      this.key = key;
      this.husket = true;
      return true;
    }
    return false;
  }

  async forgetKey() {
    if (this.meta) await idbDel('nokler', this.nokkelId);
    this.key = null;
    this.husket = false;
  }

  async readJson(path) {
    const text = await this.backend.readText(path);
    if (text == null) return null;
    if (this.meta.krevAad && !JSON.parse(text).a) throw new Error(`Filen ${path} mangler integritetsbinding og avvises.`);
    let plain;
    try {
      plain = await decryptText(this.key, text, path);
    } catch {
      if (!this.gammelKey) throw new Error(`Filen ${path} kunne ikke dekrypteres. Den er skadet eller endret utenfor FinSys.`);
      try {
        plain = await decryptText(this.gammelKey, text, path);
        this.saved.delete(path); // skrives på nytt med ny nøkkel
        this.saved.set(path + '#gammel', true);
      } catch {
        throw new Error(`Filen ${path} kunne ikke dekrypteres. Den er skadet eller endret utenfor FinSys.`);
      }
    }
    if (this.saved.has(path + '#gammel')) this.saved.delete(path + '#gammel');
    else this.saved.set(path, plain);
    return JSON.parse(plain);
  }

  // Leser hele databasen.
  async load() {
    const oppsett = await this.readJson('data/oppsett.enc');
    if (!oppsett) return null;
    const db = { ...oppsett, transaksjoner: [] };
    for (const ar of oppsett.transaksjonsAr || []) {
      const liste = await this.readJson(`data/transaksjoner-${ar}.enc`);
      if (liste) db.transaksjoner.push(...liste);
    }
    db.formue = (await this.readJson('data/formue.enc')) || { poster: [], historikk: [], utbytte: [] };
    db.inntekt = (await this.readJson('data/inntekt.enc')) || { lonnsslipper: [] };
    db.notater = (await this.readJson('data/notater.enc')) || [];
    db.dokumenter = (await this.readJson('data/dokumenter.enc')) || [];
    return db;
  }

  // Deler databasen i filer (klartekst-JSON per sti).
  split(db) {
    const files = new Map();
    const perAr = new Map();
    for (const t of db.transaksjoner) {
      const ar = (t.betalt || t.dato || '0000').slice(0, 4);
      if (!perAr.has(ar)) perAr.set(ar, []);
      perAr.get(ar).push(t);
    }
    const tidligere = new Set(db.transaksjonsAr || []);
    for (const ar of tidligere) if (!perAr.has(ar)) perAr.set(ar, []);
    const ar = [...perAr.keys()].sort();
    // eslint-disable-next-line no-unused-vars
    const { transaksjoner, formue, inntekt, notater, dokumenter, ...oppsett } = db;
    oppsett.transaksjonsAr = ar;
    db.transaksjonsAr = ar;
    for (const a of ar) {
      const liste = perAr.get(a).sort((x, y) => (x.dato || '').localeCompare(y.dato || '') || x.id.localeCompare(y.id));
      files.set(`data/transaksjoner-${a}.enc`, JSON.stringify(liste));
    }
    files.set('data/formue.enc', JSON.stringify(formue));
    files.set('data/inntekt.enc', JSON.stringify(inntekt));
    files.set('data/notater.enc', JSON.stringify(notater));
    files.set('data/dokumenter.enc', JSON.stringify(dokumenter || []));
    files.set('data/oppsett.enc', JSON.stringify(oppsett)); // sist, så den peker på ferdig skrevne filer
    return files;
  }

  hasChanges(db) {
    for (const [path, plain] of this.split(db)) if (this.saved.get(path) !== plain) return true;
    return false;
  }

  // Dokumenter (vedlegg) lagres som egne krypterte filer og skrives straks.
  // Commit-meldingen inneholder bevisst ikke filnavnet.
  async writeBlob(id, bytes) {
    const sti = `dokumenter/${id}.enc`;
    await this.backend.writeText(sti, await encryptBytes(this.key, bytes, sti), 'FinSys: legg til dokument');
  }

  async readBlob(id, krevAad = false) {
    const sti = `dokumenter/${id}.enc`;
    const text = await this.backend.readText(sti);
    if (text == null) throw new Error('Fant ikke dokumentfilen i datalageret.');
    if (krevAad && !JSON.parse(text).a) throw new Error('Dokumentfilen mangler integritetsbinding og avvises.');
    try {
      return await decryptBytes(this.key, text, sti);
    } catch (e) {
      if (this.gammelKey) return decryptBytes(this.gammelKey, text, sti);
      throw e;
    }
  }

  // Lager ny datanøkkel og krypterer alle data og dokumenter på nytt.
  // Den gamle nøkkelen ligger innpakket i meta.rotasjon til alt er skrevet, så et avbrudd kan fullføres senere.
  // Returnerer ny gjenopprettingsnøkkel (den gamle slutter å virke).
  async roterNokkel(passord, db, fremdrift) {
    const gammel = await this.eksporterbarNokkel({ passord });
    const ny = await nyDatanokkel();
    const kdf = kdfNy(KDF_ITERATIONS);
    const kek = await deriveKek(passord, kdf.salt, kdf.iterations);
    this.meta = {
      ...this.meta,
      nokler: [{ type: 'passord', kdf, ...(await pakkInn(kek, ny)) }],
      rotasjon: { kdf, ...(await pakkInn(kek, gammel)) },
      kontroll: await encryptText(ny, CHECK, META),
    };
    await this.skrivMeta('FinSys: roter datanøkkel (påbegynt)');
    this.gammelKey = await ikkeEksporterbar(gammel);
    this.key = await ikkeEksporterbar(ny);
    await this.fullforRotasjon(db, fremdrift);
    return this.lagGjenoppretting({ passord });
  }

  async fullforRotasjon(db, fremdrift) {
    if (!this.meta.rotasjon || !this.gammelKey) return;
    let i = 0;
    for (const d of db.dokumenter || []) {
      fremdrift?.(`Krypterer dokument ${++i} av ${db.dokumenter.length}`);
      const bytes = await this.readBlob(d.id, !!d.aad);
      await this.writeBlob(d.id, bytes);
      d.aad = true;
    }
    fremdrift?.('Krypterer data');
    this.saved.clear();
    await this.save(db);
    delete this.meta.rotasjon;
    await this.skrivMeta('FinSys: roter datanøkkel (fullført)');
    this.gammelKey = null;
    if (this.husket) await this.rememberKey();
  }

  async deleteBlob(id) {
    await this.backend.deleteFile(`dokumenter/${id}.enc`, 'FinSys: slett dokument');
  }

  // Skriver bare filer som er endret. Returnerer antall filer skrevet.
  async save(db) {
    let n = 0;
    for (const [path, plain] of this.split(db)) {
      if (this.saved.get(path) === plain) continue;
      await this.backend.writeText(path, await encryptText(this.key, plain, path), 'FinSys: oppdater data');
      this.saved.set(path, plain);
      n++;
    }
    if (this.meta.format === 2 && !this.meta.krevAad) {
      this.meta.krevAad = true;
      await this.skrivMeta('FinSys: krev integritetsbinding');
    }
    return n;
  }
}
