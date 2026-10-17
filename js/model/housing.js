// Boliglån og kjøpsevne etter hovedreglene i utlånsforskriften:
// samlet gjeld maks 5 × brutto årsinntekt, minst 10 % egenkapital, tåle renteøkning på 3 prosentpoeng.
// Bankene kan avvike (fleksibilitetskvote), så dette er et anslag.

import { formue, sum } from './calc.js';
import { laan } from './debt.js';
import { skatteprognose } from './tax.js';
import { mndSammendrag, manederMedData } from './report.js';
import { kategoriIndeks } from './categories.js';
import { kr } from '../util.js';

const komma = (x) => String(x).replace('.', ',');

export const REGLER = { gjeldsgrad: 5, egenkapital: 0.1, stress: 0.03, avdragGrense: 0.6, dokumentavgift: 0.025, faste: 7000 };

export function annuitet(lan, rente, aar) {
  const r = rente / 12;
  const n = aar * 12;
  if (lan <= 0) return 0;
  return r === 0 ? lan / n : (lan * r) / (1 - (1 + r) ** -n);
}

const lanFraBetaling = (betaling, rente, aar) => {
  const r = rente / 12;
  const n = aar * 12;
  if (betaling <= 0) return 0;
  return r === 0 ? betaling * n : (betaling * (1 - (1 + r) ** -n)) / r;
};

// Forslag til utgangsverdier fra dataene
export function standardverdier(db) {
  const aar = new Date().getFullYear();
  const s = skatteprognose(db, aar);
  const f = formue(db);
  const verdi = (typer) => sum(f.eiendeler.filter((x) => typer.includes(x.post.type)).map((x) => x.verdi || 0));
  const slipper = (db.inntekt?.lonnsslipper || []).slice(-3).map((l) => l.netto || 0).filter(Boolean);
  const idx = kategoriIndeks(db.kategorier);
  const mnd = manederMedData(db).slice(-6).map((m) => mndSammendrag(db, m, 'betalt', idx));
  // Livsopphold: snittforbruk uten bolig, lån og skatt (de regnes separat)
  const livsopphold = mnd.length ? sum(mnd.map((x) => -sum(db.kategorier.filter((k) => k.type === 'utgift' && !['bolig', 'lan', 'skatt'].includes(k.id)).map((k) => x.perHoved.get(k.id) || 0)))) / mnd.length : 15000;
  const lanListe = laan(db);
  return {
    inntekt: Math.round(s.bruttoAar || 0),
    nettoMnd: Math.round(slipper.length ? sum(slipper) / slipper.length : (s.bruttoAar || 0) * 0.7 / 12),
    medInntekt: 0,
    medNettoMnd: 0,
    egenkapitalBank: Math.round(verdi(['bank', 'bsu'])),
    egenkapitalInvestert: Math.round(verdi(['fond', 'aksjer', 'kontanter'])),
    gjeld: Math.round(sum(lanListe.map((l) => l.saldo))),
    gjeldBetaling: Math.round(sum(lanListe.map((l) => l.termin || l.saldo * 0.01))),
    livsopphold: 12000,
    forbrukUtenBolig: Math.round(livsopphold / 500) * 500,
    rente: 0.052,
    lopetid: 30,
    felleskost: 3000,
    boligtype: 'selveier',
    pris: 4000000,
  };
}

export function kjopsevne(inp) {
  const R = REGLER;
  const inntekt = inp.inntekt + (inp.medInntekt || 0);
  const ek = inp.egenkapital;
  const omkSats = inp.boligtype === 'selveier' ? R.dokumentavgift : 0;
  const stressRente = inp.rente + R.stress;
  const netto = inp.nettoMnd + (inp.medNettoMnd || 0);

  // 1) Gjeldsgrad
  const maksLanGjeldsgrad = Math.max(0, R.gjeldsgrad * inntekt - inp.gjeld);
  // 2) Betjeningsevne med stresset rente (eksisterende gjeld stresses grovt med +3 pp på saldo)
  const rom = netto - inp.livsopphold - inp.felleskost - inp.gjeldBetaling - (inp.gjeld * R.stress) / 12;
  const maksLanBetjening = Math.max(0, lanFraBetaling(rom, stressRente, inp.lopetid));
  const maksLan = Math.min(maksLanGjeldsgrad, maksLanBetjening);
  // 3) Egenkapital: lån ≤ 90 % av pris, og EK må også dekke omkostninger
  const prisEk = Math.max(0, (ek - R.faste) / (R.egenkapital + omkSats));
  const prisLan = Math.max(0, (maksLan + ek - R.faste) / (1 + omkSats));
  const maksPris = Math.min(prisEk, prisLan);
  const begrensning = maksPris === prisEk ? 'egenkapital' : maksLan === maksLanGjeldsgrad ? 'gjeldsgrad' : 'betjeningsevne';

  // Valgt bolig
  const omk = inp.pris * omkSats + R.faste;
  const lan = Math.max(0, inp.pris + omk - ek);
  const belaning = inp.pris > 0 ? lan / inp.pris : 0;
  const betaling = annuitet(lan, inp.rente, inp.lopetid);
  const renter1 = (lan * inp.rente) / 12;
  const stressBetaling = annuitet(lan, stressRente, inp.lopetid);
  const totalPerMnd = betaling + inp.felleskost;
  const nettoPerMnd = totalPerMnd - renter1 * 0.22;
  const sjekk = [
    { navn: `Samlet gjeld maks ${R.gjeldsgrad} × inntekt`, ok: lan + inp.gjeld <= R.gjeldsgrad * inntekt, detalj: `${komma(Math.round(((lan + inp.gjeld) / Math.max(1, inntekt)) * 10) / 10)} × inntekt` },
    { navn: `Minst ${R.egenkapital * 100} % egenkapital`, ok: belaning <= 1 - R.egenkapital, detalj: `belåningsgrad ${komma(Math.round(belaning * 1000) / 10)} %` },
    { navn: `Tåler rente + ${R.stress * 100} pp (${(stressRente * 100).toFixed(1).replace('.', ',')} %)`, ok: rom >= stressBetaling, detalj: `rom ${kr(rom)} kr/mnd mot ${kr(stressBetaling)} kr` },
  ];
  return {
    inntekt, maksLanGjeldsgrad, maksLanBetjening, maksLan, prisEk, prisLan, maksPris, begrensning, rom, stressRente,
    valgt: { omk, lan, belaning, betaling, renter1, avdrag1: betaling - renter1, stressBetaling, totalPerMnd, nettoPerMnd, avdragskrav: belaning > R.avdragGrense, sjekk, ok: sjekk.every((x) => x.ok) },
  };
}
