// Månedsrapport: nøkkeltall, sammenligning, avvik, høydepunkter og automatisk oppsummering.

import { kategoriIndeks } from './categories.js';
import { mndFor, formue, verdiPa, MND_NAVN, MND_KORT, sum, r2 } from './calc.js';
import { normaliser } from './rules.js';
import { budsjettStatus } from '../views/budget.js';
import { budsjettFor } from './years.js';
import { kr, pct } from '../util.js';

export function flyttMnd(mnd, n) {
  const [y, m] = mnd.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const mndSlutt = (mnd) => {
  const [y, m] = mnd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export const mndTekst = (mnd) => `${MND_NAVN[Number(mnd.slice(5, 7)) - 1]} ${mnd.slice(0, 4)}`;

// Summer for én måned.
export function mndSammendrag(db, mnd, grunnlag = 'betalt', idx = kategoriIndeks(db.kategorier)) {
  const s = { mnd, inntekt: 0, utgift: 0, noytral: 0, sparing: 0, antall: 0, perHoved: new Map(), perSub: new Map(), transaksjoner: [] };
  for (const t of db.transaksjoner) {
    if (mndFor(t, grunnlag) !== mnd) continue;
    const id = t.kategori && idx.hent(t.kategori) ? t.kategori : '';
    const type = id ? idx.type(id) : 'utgift';
    if (type === 'overforing') continue;
    s.antall++;
    s.transaksjoner.push(t);
    s[type] += t.belop;
    s.perSub.set(id, (s.perSub.get(id) || 0) + t.belop);
    const h = id ? idx.hovedFor(id).id : '';
    s.perHoved.set(h, (s.perHoved.get(h) || 0) + t.belop);
  }
  s.netto = s.inntekt + s.utgift + s.noytral;
  s.forbruk = -s.utgift;
  s.sparerate = s.inntekt > 0 ? s.netto / s.inntekt : null;
  return s;
}

function snittAv(liste, felt) {
  return liste.length ? sum(liste.map((x) => (typeof felt === 'function' ? felt(x) : x[felt]))) / liste.length : null;
}

export function manederMedData(db, grunnlag = 'betalt') {
  return [...new Set(db.transaksjoner.map((t) => mndFor(t, grunnlag)).filter(Boolean))].sort();
}

function formueForMnd(db, mnd) {
  const snap = (db.formue.historikk || []).find((h) => h.mnd === mnd && h.nettoformue != null);
  if (snap) return { netto: snap.nettoformue, dato: snap.dato, kilde: 'Fryst øyeblikksbilde' };
  // Beregnet formue brukes bare hvis alle poster med verdier har en kjent verdi på datoen,
  // ellers blir tallet misvisende (f.eks. gjeld med verdi, men aksjer uten).
  const f = formue(db, mndSlutt(mnd));
  const medVerdier = f.poster.filter((x) => (x.post.verdier || []).length);
  const komplett = medVerdier.length > 0 && medVerdier.every((x) => x.dato);
  return komplett ? { netto: f.netto, dato: f.sisteDato, kilde: 'Beregnet fra registrerte verdier' } : null;
}

export function lagRapport(db, mnd, grunnlag = 'betalt') {
  const idx = kategoriIndeks(db.kategorier);
  const alle = manederMedData(db, grunnlag);
  const denne = mndSammendrag(db, mnd, grunnlag, idx);
  const forrigeMnd = flyttMnd(mnd, -1);
  const forrige = mndSammendrag(db, forrigeMnd, grunnlag, idx);
  const tidligere = alle.filter((m) => m < mnd).slice(-6).map((m) => mndSammendrag(db, m, grunnlag, idx));
  const snitt = {
    antall: tidligere.length,
    inntekt: snittAv(tidligere, 'inntekt'),
    forbruk: snittAv(tidligere, 'forbruk'),
    netto: snittAv(tidligere, 'netto'),
    sparing: snittAv(tidligere, 'sparing'),
    perHoved: (id) => snittAv(tidligere, (s) => s.perHoved.get(id) || 0),
  };

  // Kategorier (inntekt og utgift) med sammenligning
  const kategorier = db.kategorier.filter((k) => k.type === 'inntekt' || k.type === 'utgift').map((k) => ({
    id: k.id,
    navn: k.navn,
    type: k.type,
    denne: denne.perHoved.get(k.id) || 0,
    forrige: forrige.perHoved.get(k.id) || 0,
    snitt: snitt.perHoved(k.id) || 0,
  })).filter((k) => Math.abs(k.denne) >= 1 || Math.abs(k.snitt) >= 1);
  if (denne.perHoved.get('')) kategorier.push({ id: '', navn: 'Ukategorisert', type: 'utgift', denne: denne.perHoved.get(''), forrige: forrige.perHoved.get('') || 0, snitt: snitt.perHoved('') || 0 });

  // Avvik fra snittet (utgifter)
  const avvik = snitt.antall >= 2 ? kategorier
    .filter((k) => k.type === 'utgift' && k.id)
    .map((k) => ({ ...k, diff: -(k.denne - k.snitt) })) // positiv = brukte mer
    .filter((k) => Math.abs(k.diff) >= Math.max(1000, 0.3 * Math.abs(k.snitt)))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 5) : [];

  // Største enkeltposter
  const utgifter = denne.transaksjoner.filter((t) => t.belop < 0 && (!t.kategori || idx.type(t.kategori) === 'utgift'));
  const storsteUt = [...utgifter].sort((a, b) => a.belop - b.belop).slice(0, 6);
  const storsteInn = denne.transaksjoner.filter((t) => t.belop > 0 && t.kategori && idx.type(t.kategori) === 'inntekt').sort((a, b) => b.belop - a.belop).slice(0, 3);

  // Nye brukersteder (ikke sett før denne måneden)
  const kjente = new Set(db.transaksjoner.filter((t) => mndFor(t, grunnlag) < mnd).map((t) => normaliser(t.tekst)));
  const nye = new Map();
  // Netto per sted, slik at refusjoner samme måned trekkes fra
  for (const t of denne.transaksjoner.filter((x) => !x.kategori || idx.type(x.kategori) === 'utgift')) {
    const n = normaliser(t.tekst);
    if (!n || kjente.has(n)) continue;
    const x = nye.get(n) || { tekst: t.tekst, belop: 0, antall: 0, kategori: t.kategori };
    x.belop += t.belop;
    x.antall++;
    nye.set(n, x);
  }
  const nyeSteder = [...nye.values()].filter((x) => x.belop <= -200).sort((a, b) => a.belop - b.belop).slice(0, 8);

  // Budsjett
  const harBudsjett = Object.keys(budsjettFor(db, mnd.slice(0, 4))).length > 0;
  const budsjett = harBudsjett ? budsjettStatus(db, mnd, grunnlag) : null;

  // Formue og gjeld
  const fNa = formueForMnd(db, mnd);
  const fFor = formueForMnd(db, forrigeMnd);
  const slutt = mndSlutt(mnd);
  const forrigeSlutt = mndSlutt(forrigeMnd);
  const gjeld = db.formue.poster.filter((p) => p.side === 'gjeld').map((p) => {
    const na = verdiPa(p, slutt);
    const fo = verdiPa(p, forrigeSlutt);
    return { navn: p.navn, saldo: na?.verdi ?? null, dato: na?.dato, endring: na && fo && na.dato !== fo.dato ? r2(na.verdi - fo.verdi) : null, rente: p.rente };
  }).filter((g) => g.saldo != null);
  const fDetalj = formue(db, slutt);

  // Lønn, notater og huskeliste
  const lonn = (db.inntekt.lonnsslipper || []).find((l) => l.mnd === mnd) || null;
  const husk = db.notater.filter((n) => n.type === 'huskeliste' && !n.ferdig && (!n.mnd || n.mnd <= flyttMnd(mnd, 1)));
  const notater = db.notater.filter((n) => n.type !== 'huskeliste' && (n.mnd === mnd || (n.dato || '').startsWith(mnd)));

  // Datakvalitet
  const ukategorisert = denne.transaksjoner.filter((t) => !t.kategori).length;
  const sisteImport = db.kontoer.filter((k) => k.id !== 'korreksjon').map((k) => {
    const d = db.transaksjoner.filter((t) => t.konto === k.id).reduce((m, t) => (t.dato > m ? t.dato : m), '');
    return { konto: k.navn, siste: d, mangler: !d || d < mndSlutt(mnd).slice(0, 8) + '20' };
  });

  // Serier for grafer (12 måneder)
  const serie = [];
  for (let i = 11; i >= 0; i--) {
    const m = flyttMnd(mnd, -i);
    const s = i === 0 ? denne : mndSammendrag(db, m, grunnlag, idx);
    serie.push({ mnd: m, etikett: MND_KORT[Number(m.slice(5, 7)) - 1], inntekt: s.inntekt, forbruk: s.forbruk, netto: s.netto, antall: s.antall });
  }
  const serie12 = serie.filter((s, i) => s.antall || serie.slice(0, i).some((x) => x.antall));
  const formueSerie = (db.formue.historikk || []).filter((h) => h.nettoformue != null && h.mnd <= mnd).sort((a, b) => a.dato.localeCompare(b.dato))
    .map((h) => ({ dato: h.dato, verdi: h.nettoformue, etikett: `${MND_KORT[Number(h.mnd.slice(5, 7)) - 1]} ${h.mnd.slice(2, 4)}` }));

  const rapport = {
    mnd, navn: mndTekst(mnd), grunnlag, laget: new Date().toISOString(),
    denne, forrige, forrigeNavn: mndTekst(forrigeMnd), snitt,
    kategorier, avvik, storsteUt, storsteInn, nyeSteder, budsjett,
    formue: fNa, formueForrige: fFor, formueDetalj: fDetalj, gjeld,
    lonn, husk, notater, ukategorisert, sisteImport, serie12, formueSerie,
    harData: denne.antall > 0,
  };
  rapport.oppsummering = lagOppsummering(rapport);
  return rapport;
}

// Lager en kort tekst i hele setninger ut fra tallene.
function lagOppsummering(r) {
  const d = r.denne;
  const mndLav = r.navn.split(' ')[0].toLowerCase();
  const avsnitt = [];
  if (!r.harData) return ['Det er ingen transaksjoner registrert for denne måneden ennå.'];

  let s = `I ${mndLav} var inntektene ${kr(d.inntekt)} kr og forbruket ${kr(d.forbruk)} kr. `;
  s += d.netto >= 0
    ? `Det ga et overskudd på ${kr(d.netto)} kr, en sparerate på ${pct(d.sparerate)}.`
    : `Det ga et underskudd på ${kr(-d.netto)} kr.`;
  if (r.snitt.antall >= 2) {
    const diff = d.netto - r.snitt.netto;
    if (Math.abs(diff) >= 500) s += ` Det er ${kr(Math.abs(diff))} kr ${diff > 0 ? 'bedre' : 'svakere'} enn snittet for de ${r.snitt.antall} foregående månedene (${kr(r.snitt.netto)} kr).`;
  }
  if (d.sparing < 0) s += ` I tillegg ble ${kr(-d.sparing)} kr flyttet til investeringer.`;
  avsnitt.push(s);

  const utgiftKat = r.kategorier.filter((k) => k.type === 'utgift' && k.denne < 0).sort((a, b) => a.denne - b.denne);
  if (utgiftKat.length) {
    const st = utgiftKat[0];
    let t = `Største utgiftsområde var ${st.navn.toLowerCase()} med ${kr(-st.denne)} kr (${pct(-st.denne / d.forbruk)} av forbruket).`;
    const mer = r.avvik.filter((a) => a.diff > 0).slice(0, 2);
    const mindre = r.avvik.filter((a) => a.diff < 0).slice(0, 1);
    if (mer.length) t += ` Høyere enn vanlig: ${mer.map((a) => `${a.navn.toLowerCase()} (+${kr(a.diff)} kr mot snittet)`).join(' og ')}.`;
    if (mindre.length) t += ` Lavere enn vanlig: ${mindre.map((a) => `${a.navn.toLowerCase()} (${kr(a.diff)} kr)`).join(', ')}.`;
    avsnitt.push(t);
  }

  if (r.formue) {
    let t = `Nettoformuen var ${kr(r.formue.netto)} kr ved utgangen av måneden`;
    if (r.formueForrige) {
      const e = r.formue.netto - r.formueForrige.netto;
      t += Math.abs(e) >= 1 ? `, ${e > 0 ? 'opp' : 'ned'} ${kr(Math.abs(e))} kr fra ${r.forrigeNavn.split(' ')[0].toLowerCase()}` : '';
    }
    t += '.';
    const nedbetalt = r.gjeld.filter((g) => g.endring != null && g.endring < 0);
    if (nedbetalt.length) t += ` Gjelden ble redusert med ${kr(-sum(nedbetalt.map((g) => g.endring)))} kr.`;
    avsnitt.push(t);
  }

  if (r.budsjett) {
    const med = r.budsjett.rader.filter((x) => x.budsjett);
    const over = med.filter((x) => x.andel > 1);
    avsnitt.push(over.length
      ? `${med.length - over.length} av ${med.length} budsjettposter holdt seg innenfor. Over budsjett: ${over.map((x) => `${x.navn.toLowerCase()} (${Math.round(x.andel * 100)} %)`).join(', ')}.`
      : `Alle ${med.length} budsjettposter holdt seg innenfor budsjettet.`);
  }

  if (r.lonn && r.lonn.brutto) {
    avsnitt.push(`Utbetalt lønn var ${kr(r.lonn.netto)} kr av ${kr(r.lonn.brutto)} kr brutto, med et skattetrekk på ${pct(-r.lonn.skattetrekk / r.lonn.brutto)}.`);
  }

  if (r.nyeSteder.length) {
    avsnitt.push(`Nye steder denne måneden: ${r.nyeSteder.slice(0, 3).map((x) => `${x.tekst} (${kr(-x.belop)} kr)`).join(', ')}.`);
  }
  if (r.ukategorisert) avsnitt.push(`${r.ukategorisert} transaksjoner mangler kategori, så fordelingen kan endre seg.`);
  return avsnitt;
}

// ---------- Årsrapport ----------

export function lagAarsrapport(db, aar, grunnlag = 'betalt') {
  const idx = kategoriIndeks(db.kategorier);
  const mnder = Array.from({ length: 12 }, (_, i) => `${aar}-${String(i + 1).padStart(2, '0')}`);
  const sammendrag = mnder.map((m) => mndSammendrag(db, m, grunnlag, idx));
  const medData = sammendrag.filter((s) => s.antall);
  const tot = (felt) => sum(medData.map((s) => s[felt]));
  const forrigeAar = mnder.map((m) => mndSammendrag(db, flyttMnd(m, -12), grunnlag, idx));
  const harForrige = forrigeAar.some((s) => s.antall);

  const perHoved = (liste, id) => sum(liste.map((s) => s.perHoved.get(id) || 0));
  const kategorier = db.kategorier.filter((k) => k.type === 'inntekt' || k.type === 'utgift').map((k) => ({
    id: k.id, navn: k.navn, type: k.type,
    aar: perHoved(medData, k.id),
    forrige: harForrige ? perHoved(forrigeAar, k.id) : null,
    perMnd: medData.length ? perHoved(medData, k.id) / medData.length : 0,
  })).filter((k) => Math.abs(k.aar) >= 1 || (k.forrige && Math.abs(k.forrige) >= 1));

  const slutt = `${aar}-12-31`;
  const start = `${aar - 1}-12-31`;
  const snapshots = (db.formue.historikk || []).filter((h) => h.nettoformue != null).sort((a, b) => a.dato.localeCompare(b.dato));
  const forsteSnap = snapshots.find((h) => h.dato.startsWith(String(aar))) || null;
  const sisteSnap = [...snapshots].reverse().find((h) => h.dato <= slutt && h.dato.startsWith(String(aar))) || null;
  const fSlutt = formue(db, slutt);

  // Sjekkliste for skattemeldingen (verdier pr. 31.12 eller siste kjente)
  const sjekk = [];
  const postVerdi = (p) => verdiPa(p, slutt);
  const gruppe = (navn, poster, merknad) => {
    const linjer = poster.map((p) => ({ navn: p.navn, verdi: postVerdi(p)?.verdi ?? null, dato: postVerdi(p)?.dato ?? null, skattemessig: p.skattemessigVerdi ?? null })).filter((x) => x.verdi != null);
    if (linjer.length) sjekk.push({ navn, linjer, merknad });
  };
  const E = db.formue.poster.filter((p) => p.side === 'eiendel');
  const G = db.formue.poster.filter((p) => p.side === 'gjeld');
  gruppe('Bankinnskudd', E.filter((p) => p.type === 'bank'), 'Forhåndsutfylt fra bankene – kontroller saldo pr. 31.12.');
  gruppe('BSU', E.filter((p) => p.type === 'bsu'), 'Skattefradrag 10 % av årets innbetaling (til og med året du fyller 33).');
  gruppe('Aksjesparekonto og aksjer/fond', E.filter((p) => ['fond', 'aksjer', 'kontanter'].includes(p.type)), 'Forhåndsutfylt fra forvalter. Verdsettelsesrabatt 20 % for aksjer og fond. Utbytte i ASK beskattes først ved uttak.');
  gruppe('Unoterte aksjer', E.filter((p) => p.type === 'selskap'), 'Formuesverdi fra aksjonærregisteroppgaven (selskapets skattemessige verdi), ikke markedsverdi.');
  gruppe('Kjøretøy', E.filter((p) => p.type === 'kjoretoy'), 'Formuesverdi fastsatt av Skatteetaten ut fra listepris og alder – ikke markedsverdi.');
  gruppe('Pensjon', E.filter((p) => p.type === 'pensjon'), 'EPK/IPS er unntatt formuesskatt. IPS-innskudd gir fradrag.');
  gruppe('Gjeld', G, 'Forhåndsutfylt fra långiverne. Kontroller saldo og renter mot årsoppgavene.');
  const renter = G.filter((p) => p.rente).map((p) => ({ navn: p.navn, renter: (postVerdi(p)?.verdi || 0) * p.rente }));
  const fagforening = -sum(db.transaksjoner.filter((t) => (t.betalt || t.dato || '').startsWith(String(aar)) && t.belop < 0 && /forbund|fagforening/i.test(t.tekst)).map((t) => t.belop));
  const utbytte = (db.formue.utbytte || []).filter((u) => String(u.aar) === String(aar));

  return {
    aar, grunnlag, navn: `Årsrapport ${aar}`,
    mnder: sammendrag.map((s, i) => ({ mnd: mnder[i], navn: MND_KORT[i], ...s })),
    antallMnd: medData.length,
    inntekt: tot('inntekt'), forbruk: tot('forbruk'), netto: tot('netto'), sparing: -tot('sparing'),
    sparerate: tot('inntekt') > 0 ? tot('netto') / tot('inntekt') : null,
    forrige: harForrige ? { inntekt: sum(forrigeAar.map((s) => s.inntekt)), forbruk: sum(forrigeAar.map((s) => s.forbruk)), netto: sum(forrigeAar.map((s) => s.netto)) } : null,
    kategorier,
    formueStart: forsteSnap, formueSlutt: sisteSnap, formueBeregnet: fSlutt,
    sjekk, renter, fagforening, utbytte, startDato: start,
  };
}
